import type { MercuryConfig } from '../utils/config.js';
import { getMemoryDir } from '../utils/config.js';
import { SecondBrainDB, type MemoryRow, type PersonListRow, type PersonGraph, type PersonKind } from './second-brain-db.js';
import { BeliefStore, type Belief, type BeliefKind } from './beliefs.js';
import { looksLikeSecret } from '../learning/text.js';
import { join } from 'node:path';
import { copyFileSync, existsSync } from 'node:fs';
import { logger } from '../utils/logger.js';

export type UserMemoryType =
  | 'identity'
  | 'preference'
  | 'goal'
  | 'project'
  | 'habit'
  | 'decision'
  | 'constraint'
  | 'relationship'
  | 'episode'
  | 'reflection';

export interface UserMemoryRecord {
  id: string;
  type: UserMemoryType;
  categories: string[];
  shareable: boolean;
  summary: string;
  detail?: string | null;
  scope: 'durable' | 'active' | 'subconscious';
  evidenceKind: 'direct' | 'inferred' | 'manual' | 'system';
  source: 'conversation' | 'system';
  confidence: number;
  importance: number;
  durability: number;
  evidenceCount: number;
  provenance?: string | null;
  dismissed: boolean;
  supersededBy?: string | null;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  lastUsedAt?: number | null;
  lastUsedQuery?: string | null;
}

export interface UserMemoryCandidate {
  type: UserMemoryType;
  summary: string;
  detail?: string;
  categories?: string[];
  shareable?: boolean;
  evidenceKind?: 'direct' | 'inferred';
  confidence: number;
  importance: number;
  durability: number;
}

export interface UserMemorySummary {
  total: number;
  subconsciousTotal: number;
  byType: Partial<Record<UserMemoryType, number>>;
  learningPaused: boolean;
  profileSummary?: string;
  activeSummary?: string;
}

export interface RetrievedUserMemory {
  records: UserMemoryRecord[];
  context: string;
}

export interface UserPersonRecord {
  id: string;
  name: string;
  canonicalName: string;
  relationshipToUser: string | null;
  description: string | null;
  confidence: number;
  memoryCount: number;
  /** 'person' | 'pet' | 'unverified'. */
  kind: string;
  /** 'owner' | 'model' | 'model-rejected' | null. */
  verifiedBy: string | null;
  /** Contact card: phone, email, birthday, location, company, notes, links. */
  meta: Record<string, unknown>;
  ownerEdited: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
}

// 8: stricter name rules, owner overrides, model checks for new names, beliefs indexed.
const PERSON_INDEX_VERSION = '9';

export class UserMemoryStore {
  private db: SecondBrainDB;
  private userKey: string;
  private consolidateThrottleMs: number;
  private lastConsolidateAt: number = 0;
  /** When true, new memories are marked shareable for cloud fetch. */
  private shareLearning: boolean;
  /** What Mercury believes about this owner, with evidence (ADR-026). Shares the database. */
  readonly beliefs: BeliefStore;

  constructor(config: MercuryConfig, userKey: string = 'user:owner', dbPath?: string) {
    this.userKey = userKey;
    this.consolidateThrottleMs = 5 * 60 * 1000;
    this.shareLearning = config.memory.collaborativeKnowledge?.shareLearning ?? false;
    const resolvedDbPath = dbPath ?? join(getMemoryDir(), 'second-brain', 'second-brain.db');
    this.db = new SecondBrainDB(resolvedDbPath);
    this.db.init();
    this.beliefs = new BeliefStore(this.db.connection, userKey);
    this.beliefs.init();
    try {
      // The one-time move into beliefs (ADR-026) happens on the first boot
      // after an upgrade. A copy of the database goes next to it first, so an
      // existing owner can always get their old Second Brain back.
      if (!this.beliefs.migrationDone() && this.beliefs.legacyRowCount() > 0) backupDatabase(resolvedDbPath);
      const migrated = this.beliefs.migrateLegacyMemories();
      if (!migrated.skipped) logger.info(migrated, 'Second Brain: legacy memories migrated into beliefs');
    } catch (err) {
      logger.warn({ err }, 'Second Brain: belief migration failed (continuing with legacy memories)');
    }
  }

  /** Toggle whether new memories are marked shareable. */
  setShareLearning(enabled: boolean): void {
    this.shareLearning = enabled;
  }

  isShareLearning(): boolean {
    return this.shareLearning;
  }

  /**
   * Everything below reads and writes the belief store (ADR-026): one source
   * of truth. The legacy `memories` table is a read-only archive kept for the
   * quarantine queue and the persons graph; nothing new is written to it.
   */
  getSummary(): UserMemorySummary {
    const byKind = this.beliefs.countsByKind();
    const byType: Partial<Record<UserMemoryType, number>> = {};
    for (const [kind, n] of Object.entries(byKind)) {
      const t = kindToType(kind as BeliefKind);
      byType[t] = (byType[t] ?? 0) + n;
    }
    const counts = this.beliefs.counts();
    const brief = this.readBrief();
    return {
      total: counts.candidate + counts.held + counts.confirmed + counts.contested,
      subconsciousTotal: counts.retired,
      byType,
      learningPaused: this.isLearningPaused(),
      profileSummary: brief.about || undefined,
      activeSummary: brief.howToWork || undefined,
    };
  }

  /** The "About the owner" brief the reflection pass wrote (ADR-026). */
  getProfile(): string {
    return this.readBrief().about;
  }

  /** The "How to work with the owner" brief the reflection pass wrote. */
  getActiveSummary(): string {
    return this.readBrief().howToWork;
  }

  getRecent(limit: number = 10): UserMemoryRecord[] {
    return this.beliefs.recent(limit).map((b) => this.toBeliefRecord(b));
  }

  /**
   * Incremental fetch — shareable beliefs newer than the cursor. Used by the
   * cloud `memory.fetch` WS handler. Ordered by `updatedAt` ascending so the
   * caller can advance its watermark to the max.
   */
  getShareableSince(since: number, limit: number = 500): UserMemoryRecord[] {
    return this.beliefs.shareableSince(since, limit).map((b) => this.toBeliefRecord(b));
  }

  countShareable(): number {
    return this.beliefs.countShareable();
  }

  getShareable(limit: number = 50): UserMemoryRecord[] {
    return this.beliefs.shareable(limit).map((b) => this.toBeliefRecord(b));
  }

  setShareable(id: string, shareable: boolean): void {
    if (!this.beliefs.setShareable(id, shareable)) this.db.setShareable(id, shareable);
  }

  search(query: string, limit: number = 10): UserMemoryRecord[] {
    return this.beliefs.search(query, limit).map((b) => this.toBeliefRecord(b));
  }

  /** Search including retired beliefs (the dashboard's "all" scope). */
  searchAll(query: string, limit: number = 20): UserMemoryRecord[] {
    return this.beliefs.search(query, limit, ['candidate', 'held', 'confirmed', 'contested', 'retired']).map((b) => this.toBeliefRecord(b));
  }

  getByType(type: UserMemoryType): UserMemoryRecord[] {
    const kinds = typeToKinds(type);
    if (kinds.length === 0) return [];
    return this.beliefs.list({ kinds, limit: 500 }).map((b) => this.toBeliefRecord(b));
  }

  listPersons(query?: string, limit: number = 100): UserPersonRecord[] {
    this.indexNewBeliefs();
    const rows = this.db.listPersons(this.userKey, query, limit);
    return rows.map(row => this.toPersonRecord(row));
  }

  getPerson(personId: string): UserPersonRecord | null {
    this.ensurePersonsBackfilled();
    const row = this.db.getPersonWithCount(this.userKey, personId);
    if (!row) return null;
    return this.toPersonRecord(row);
  }

  // ── Owner curation of people (stable ids; rebuilds respect every decision) ──

  updatePerson(personId: string, fields: { displayName?: string; relationship?: string | null; description?: string | null; kind?: PersonKind; meta?: Record<string, unknown> }): UserPersonRecord | null {
    if (!this.db.updatePerson(this.userKey, personId, fields)) return null;
    return this.getPerson(personId);
  }

  markNotPerson(personId: string): boolean {
    return this.db.markNotPerson(this.userKey, personId);
  }

  mergePersons(fromId: string, intoId: string): boolean {
    return this.db.mergePersons(this.userKey, fromId, intoId);
  }

  personGraph(maxMemories: number): PersonGraph {
    this.indexNewBeliefs();
    return this.db.personGraph(this.userKey, maxMemories);
  }

  pendingPersonChecks(limit: number) {
    this.indexNewBeliefs();
    return this.db.pendingPersonChecks(this.userKey, limit);
  }

  queueExistingPersonChecks(): number {
    this.indexNewBeliefs();
    return this.db.queueExistingPersonChecks(this.userKey);
  }

  countPersonChecks(): number {
    this.indexNewBeliefs();
    return this.db.countPersonChecks(this.userKey);
  }

  applyPersonCheck(personId: string, verdict: 'person' | 'pet' | 'not_person' | 'unsure'): void {
    this.db.applyPersonCheck(this.userKey, personId, verdict);
  }

  getPersonMemories(personId: string, limit: number = 50): UserMemoryRecord[] {
    this.indexNewBeliefs();
    const live = this.db.getBeliefIdsForPerson(personId, limit)
      .map((id) => this.beliefs.get(id))
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
      .map((b) => this.toBeliefRecord(b));
    const legacy = this.db.getMemoriesForPerson(this.userKey, personId, limit).map(row => this.toRecord(row));
    return [...live, ...legacy].slice(0, limit);
  }

  /** True while persons are rebuilt from old memories: those never queue model checks. */
  private rebuilding = false;

  rebuildPersonsFromMemory(): number {
    this.db.clearUserPersonGraph(this.userKey);
    const rows = this.db.getRelationshipMemoryRows(this.userKey);
    this.db.clearAllBeliefPersons(this.userKey);
    this.rebuilding = true;
    try {
      for (const row of rows) {
        this.indexPersonsForMemoryRow(row);
      }
      // The live brain: every current belief, as of now.
      const cursor = Date.now();
      for (const b of this.db.beliefsSince(this.userKey, 0, 100_000)) this.indexPersonsForBelief(b);
      this.db.setMeta(`${this.userKey}:persons_belief_cursor`, String(cursor));
    } finally {
      this.rebuilding = false;
    }
    this.db.deleteOrphanPersons(this.userKey);
    this.db.setMeta(`${this.userKey}:persons_backfilled`, '1');
    this.db.setMeta(`${this.userKey}:persons_backfilled_version`, PERSON_INDEX_VERSION);
    return rows.length;
  }

  /**
   * Beliefs relevant to a message, as a context block. The agent's own turn
   * path injects beliefs itself; this serves the bots and anything else that
   * wants one call.
   */
  retrieveRelevant(
    query: string,
    options?: { maxRecords?: number; maxChars?: number },
  ): RetrievedUserMemory {
    const maxRecords = options?.maxRecords ?? 5;
    const maxChars = options?.maxChars ?? 900;
    const relevant = this.beliefs.searchRelevant(query, maxRecords);
    if (relevant.length === 0) return { records: [], context: '' };

    const selected: typeof relevant = [];
    let currentLength = 0;
    for (const b of relevant) {
      const line = `- [${kindToType(b.kind)}] ${b.statement}`;
      if (selected.length > 0 && currentLength + line.length > maxChars) break;
      selected.push(b);
      currentLength += line.length + 1;
    }
    this.beliefs.markUsed(selected.map((b) => b.id));
    const context = ['Relevant user memory:', ...selected.map((b) => `- [${kindToType(b.kind)}] ${b.statement}`)].join('\n');
    return { records: selected.map((b) => this.toBeliefRecord(b)), context };
  }

  /**
   * Explicit saves (the save_memory tool, the dashboard's "add" form) become
   * beliefs: a direct save is the owner's word (confirmed, never decays); an
   * inferred one is a candidate that has to earn its place like any other.
   */
  remember(
    candidates: UserMemoryCandidate[],
    source: UserMemoryRecord['source'] = 'conversation',
  ): UserMemoryRecord[] {
    if (this.isLearningPaused()) return [];
    const remembered: UserMemoryRecord[] = [];
    for (const candidate of candidates) {
      const summary = candidate.summary?.trim() ?? '';
      if (summary.length < 4 || looksLikeSecret(summary) || (candidate.detail && looksLikeSecret(candidate.detail))) continue;
      const kind = typeToKinds(candidate.type)[0] ?? 'fact';
      const direct = candidate.evidenceKind !== 'inferred';
      const result = this.beliefs.apply({
        op: direct ? 'owner_stated' : 'create',
        kind,
        statement: summary,
        detail: candidate.detail?.trim() || undefined,
        context: '*',
        timescale: kind === 'situation' ? 'situational' : kind === 'episode' ? 'episodic' : 'stable',
        excerpt: source === 'system' ? 'saved by Mercury' : 'asked Mercury to remember this',
        evidenceKind: direct ? 'owner' : 'observed',
        weight: direct ? 2 : 1,
        shareable: candidate.shareable ?? this.shareLearning,
      });
      if (result) remembered.push(this.toBeliefRecord(result.belief));
    }
    return remembered;
  }

  setLearningPaused(paused: boolean): void {
    this.db.setMeta(`${this.userKey}:learning_paused`, paused ? '1' : '0');
  }

  isLearningPaused(): boolean {
    return this.db.getMeta(`${this.userKey}:learning_paused`) === '1';
  }

  /** "Clear all memories": beliefs, their evidence and the legacy archive, gone. */
  clear(): number {
    const beliefs = this.beliefs.clearAll();
    const legacy = this.db.clearByType(this.userKey);
    return beliefs + legacy;
  }

  /**
   * @deprecated The reflection pass (Agent.reflectNow) maintains the owner
   * brief now. Kept so older callers keep working; does nothing.
   */
  consolidate(): { profileUpdated: boolean; reflectionCount: number } {
    return { profileUpdated: false, reflectionCount: 0 };
  }

  softDeleteMemory(id: string): boolean {
    if (this.beliefs.forget(id)) return true;
    const row = this.db.getById(id);
    return row && row.user_key === this.userKey ? this.db.softDelete(id) : false;
  }

  updateMemory(id: string, updates: Record<string, any>): UserMemoryRecord | null {
    const belief = this.beliefs.get(id);
    if (belief) {
      const kind = typeof updates.type === 'string' ? typeToKinds(updates.type as UserMemoryType)[0] : undefined;
      const edited = this.beliefs.edit(id, {
        statement: typeof updates.summary === 'string' ? updates.summary : undefined,
        detail: updates.detail === undefined ? undefined : (updates.detail ?? null),
        kind,
      });
      if (edited && typeof updates.shareable === 'boolean') this.beliefs.setShareable(id, updates.shareable);
      const fresh = this.beliefs.get(id);
      return fresh ? this.toBeliefRecord(fresh) : null;
    }
    const existing = this.db.getById(id);
    if (!existing || existing.user_key !== this.userKey) return null;
    this.db.update({ id, ...updates, updated_at: Date.now() });
    const updated = this.db.getById(id);
    return updated ? this.toRecord(updated) : null;
  }

  /** The decay pass: beliefs that faded and were contradicted or went stale retire. */
  prune(): { movedToSubconscious: number; promoted: number; hardDeleted: number } {
    const retired = this.beliefs.decayPass();
    if (retired > 0) logger.debug({ retired, userKey: this.userKey }, 'Retired faded beliefs');
    return { movedToSubconscious: retired, promoted: 0, hardDeleted: 0 };
  }

  /** Retired beliefs: still searchable, no longer shown to the model. */
  getSubconscious(limit: number = 10): UserMemoryRecord[] {
    return this.beliefs.list({ statuses: ['retired'], limit }).map((b) => this.toBeliefRecord(b));
  }

  getById(id: string): UserMemoryRecord | null {
    const belief = this.beliefs.get(id);
    if (belief) return this.toBeliefRecord(belief);
    const row = this.db.getById(id);
    return row && row.user_key === this.userKey ? this.toRecord(row) : null;
  }

  /** Legacy rows the belief migration quarantined (ADR-026 §3.7), for the dashboard's review queue. */
  listQuarantined(limit: number = 500): UserMemoryRecord[] {
    return this.db.listQuarantined(this.userKey, limit).map(row => this.toRecord(row));
  }

  /** Restoring a quarantined row turns it into a belief the owner vouched for; returns the belief's id. */
  restoreQuarantined(id: string): string | null {
    const row = this.db.getById(id);
    if (!row || row.user_key !== this.userKey || row.scope !== 'quarantine' || row.dismissed) return null;
    const kind = typeToKinds(row.type as UserMemoryType)[0] ?? 'fact';
    const result = this.beliefs.apply({
      op: 'owner_stated', kind, statement: row.summary, detail: row.detail ?? undefined, context: '*',
      timescale: kind === 'situation' ? 'situational' : kind === 'episode' ? 'episodic' : 'stable',
      excerpt: 'restored from quarantine by the owner', evidenceKind: 'owner', weight: 2,
    });
    if (!result) return null;
    this.db.update({ id, dismissed: 1, provenance: `migration:restored→${result.belief.id}`, updated_at: Date.now() });
    return result.belief.id;
  }

  close(): void {
    this.db.close();
  }

  private readBrief(): { about: string; howToWork: string } {
    try {
      const raw = this.beliefs.getMeta('brief');
      if (!raw) return { about: '', howToWork: '' };
      const parsed = JSON.parse(raw) as { about?: string; howToWork?: string };
      return { about: (parsed.about ?? '').trim(), howToWork: (parsed.howToWork ?? '').trim() };
    } catch {
      return { about: '', howToWork: '' };
    }
  }

  /** A belief in the record shape every existing reader (menus, dashboard, cloud sync) expects. */
  private toBeliefRecord(b: Belief): UserMemoryRecord {
    const confidence = this.beliefs.confidence(b);
    const scope: UserMemoryRecord['scope'] = b.status === 'held' || b.status === 'confirmed' ? 'durable'
      : b.status === 'retired' || b.status === 'forgotten' ? 'subconscious' : 'active';
    const categories = [b.kind, ...(b.dimension ? [b.dimension] : []), ...(b.context !== '*' ? [b.context] : [])];
    return {
      id: b.id,
      type: kindToType(b.kind),
      categories,
      shareable: b.shareable,
      summary: b.statement,
      detail: b.detail,
      scope,
      evidenceKind: b.ownerStated ? 'direct' : 'inferred',
      source: 'conversation',
      confidence,
      importance: b.status === 'confirmed' ? 0.9 : b.status === 'held' ? 0.75 : b.status === 'contested' ? 0.6 : 0.5,
      durability: b.timescale === 'stable' ? 0.9 : b.timescale === 'episodic' ? 0.5 : 0.2,
      evidenceCount: Math.max(1, Math.round(b.support)),
      provenance: `belief:${b.status}${b.level ? `:${b.level}` : ''}`,
      dismissed: b.status === 'forgotten',
      supersededBy: b.supersededBy,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      lastSeenAt: b.lastSupportedAt,
      lastUsedAt: b.lastUsedAt,
      lastUsedQuery: null,
    };
  }

  private ensurePersonsBackfilled(): void {
    const done = this.db.getMeta(`${this.userKey}:persons_backfilled`) === '1';
    const version = this.db.getMeta(`${this.userKey}:persons_backfilled_version`);
    if (done && version === PERSON_INDEX_VERSION) return;
    this.rebuildPersonsFromMemory();
  }

  private toPersonRecord(row: PersonListRow): UserPersonRecord {
    return {
      id: row.id,
      name: row.display_name,
      canonicalName: row.canonical_name,
      relationshipToUser: row.relationship_to_user,
      description: row.description,
      confidence: row.confidence,
      memoryCount: row.memory_count,
      kind: row.kind ?? 'unverified',
      verifiedBy: row.verified_by ?? null,
      meta: parseMeta(row.meta),
      ownerEdited: row.owner_edited === 1,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * People in beliefs created since the last pass. These are NEW mentions, so
   * new people they create are queued for a check. Cheap when nothing is new.
   */
  indexNewBeliefs(): number {
    this.ensurePersonsBackfilled();
    const since = Number(this.db.getMeta(`${this.userKey}:persons_belief_cursor`) ?? '0') || 0;
    const fresh = this.db.beliefsSince(this.userKey, since, 200);
    for (const b of fresh) this.indexPersonsForBelief(b);
    if (fresh.length) this.db.setMeta(`${this.userKey}:persons_belief_cursor`, String(fresh[fresh.length - 1].created_at));
    return fresh.length;
  }

  private indexPersonsForBelief(b: { id: string; statement: string; detail: string | null; kind: string; confidence: number }): void {
    const text = `${b.statement} ${b.detail ?? ''}`.trim();
    if (!text) return;
    this.db.clearBeliefPersons(b.id);
    const queueCheck = this.rebuilding ? null : { context: text };
    const seen = new Set<string>();
    const link = (name: string, relation: string | null, role: string) => {
      const person = this.db.upsertPerson({ userKey: this.userKey, name, relationshipToUser: relation, confidence: b.confidence, queueCheck });
      if (!person || seen.has(person.id)) return;
      seen.add(person.id);
      this.db.addPersonAlias(person.id, name, 'memory');
      this.db.linkBeliefPerson(b.id, person.id, role, b.confidence);
    };
    for (const m of extractUserRelationshipMentions(text)) link(m.name, m.relation, 'relationship');
    // New people come only from beliefs about people; other beliefs link to people already known.
    if (b.kind === 'relationship' || b.kind === 'episode') {
      // A belief about a relationship is about people: a name may open the sentence there
      // ("Shehzen visited"); new names from it are checked by the model anyway.
      for (const name of extractHumanNames(text, b.kind === 'relationship')) link(name, b.kind === 'relationship' ? 'known' : null, 'mention');
    }
    // Known people mentioned by name or alias.
    for (const person of this.db.listPersons(this.userKey, '', 300)) {
      if (seen.has(person.id)) continue;
      if (mentionsPerson(text, person.display_name) || mentionsPerson(text, person.canonical_name)) {
        seen.add(person.id);
        this.db.linkBeliefPerson(b.id, person.id, 'interaction', b.confidence);
      }
    }
  }

  private indexPersonsForMemory(memory: UserMemoryRecord): void {
    const row = this.db.getById(memory.id);
    if (row) this.indexPersonsForMemoryRow(row);
  }

  private indexPersonsForMemoryRow(memory: MemoryRow): void {
    if (memory.dismissed === 1) return;
    if (!['relationship', 'episode', 'identity', 'project'].includes(memory.type)) return;

    const text = `${memory.summary} ${memory.detail ?? ''}`.trim();
    if (!text) return;

    this.db.clearMemoryPersons(memory.id);
    this.db.clearRelationshipsByMemory(memory.id);

    if (memory.type === 'relationship') {
      const relationMentions = extractUserRelationshipMentions(text);
      if (relationMentions.length > 0) {
        for (const mention of relationMentions) {
          const person = this.db.upsertPerson({
            userKey: this.userKey,
            name: mention.name,
            relationshipToUser: mention.relation,
            confidence: memory.confidence,
            queueCheck: this.rebuilding ? null : { context: text },
          });
          if (!person) continue;
          this.db.addPersonAlias(person.id, mention.name, 'memory');
          this.db.linkMemoryPerson(memory.id, person.id, 'relationship', memory.confidence);
        }
      } else {
        // Fallback: extract any capitalized names from relationship memories
        const names = extractHumanNames(text);
        for (const name of names) {
          const person = this.db.upsertPerson({
            userKey: this.userKey,
            name,
            relationshipToUser: 'known',
            confidence: memory.confidence,
            queueCheck: this.rebuilding ? null : { context: text },
          });
          if (!person) continue;
          this.db.addPersonAlias(person.id, name, 'memory');
          this.db.linkMemoryPerson(memory.id, person.id, 'relationship', memory.confidence);
        }
      }
      return;
    }

    // For identity/project/episode: extract names and create/link persons
    const names = extractHumanNames(text);
    for (const name of names) {
      const person = this.db.upsertPerson({
        userKey: this.userKey,
        name,
        relationshipToUser: 'known',
        confidence: memory.confidence,
        queueCheck: this.rebuilding ? null : { context: text },
      });
      if (!person) continue;
      this.db.addPersonAlias(person.id, name, 'memory');
      this.db.linkMemoryPerson(memory.id, person.id, 'mention', memory.confidence);
    }

    // Also link to already-known persons by alias/name match
    const knownPersons = this.db.listPersons(this.userKey, '', 300);
    for (const person of knownPersons) {
      if (mentionsPerson(text, person.display_name) || mentionsPerson(text, person.canonical_name)) {
        this.db.linkMemoryPerson(memory.id, person.id, 'interaction', memory.confidence);
      }
    }
  }

  private toRecord(row: MemoryRow): UserMemoryRecord {
    let categories: string[] = [];
    try {
      const parsed = JSON.parse(row.categories ?? '[]');
      if (Array.isArray(parsed)) categories = parsed as string[];
    } catch { /* malformed */ }
    return {
      id: row.id,
      type: row.type as UserMemoryType,
      categories,
      shareable: row.shareable === 1,
      summary: row.summary,
      detail: row.detail,
      scope: row.scope as 'durable' | 'active' | 'subconscious',
      evidenceKind: row.evidence_kind as UserMemoryRecord['evidenceKind'],
      source: row.source as UserMemoryRecord['source'],
      confidence: row.confidence,
      importance: row.importance,
      durability: row.durability,
      evidenceCount: row.evidence_count,
      provenance: row.provenance,
      dismissed: row.dismissed === 1,
      supersededBy: row.superseded_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastSeenAt: row.last_seen_at,
      lastUsedAt: row.last_used_at,
      lastUsedQuery: row.last_used_query,
    };
  }
}

const USER_RELATION_ROLE_MAP: Record<string, string> = {
  wife: 'wife',
  wives: 'wife',
  husband: 'husband',
  husbands: 'husband',
  mother: 'mother',
  mothers: 'mother',
  mom: 'mother',
  moms: 'mother',
  father: 'father',
  fathers: 'father',
  dad: 'father',
  dads: 'father',
  brother: 'family',
  brothers: 'family',
  sister: 'family',
  sisters: 'family',
  son: 'family',
  sons: 'family',
  daughter: 'family',
  daughters: 'family',
  family: 'family',
  families: 'family',
  cousin: 'family',
  cousins: 'family',
  friend: 'friend',
  friends: 'friend',
  colleague: 'colleague',
  colleagues: 'colleague',
  coworker: 'colleague',
  coworkers: 'colleague',
  teammate: 'colleague',
  teammates: 'colleague',
  partner: 'partner',
  partners: 'partner',
  developer: 'colleague',
  developers: 'colleague',
  'co-founder': 'partner',
  cofounder: 'partner',
  cofounders: 'partner',
  boss: 'colleague',
  manager: 'colleague',
  mentor: 'colleague',
  mentee: 'colleague',
  cto: 'colleague',
  ceo: 'colleague',
  lover: 'partner',
  girlfriend: 'partner',
  boyfriend: 'partner',
  fiancee: 'partner',
  fiance: 'partner',
  spouse: 'partner',
};

const NON_PERSON_TERMS = new Set([
  'User', 'Users',
  'I', 'The', 'This', 'That', 'Today', 'Tomorrow', 'Yesterday', 'Monday', 'Tuesday',
  'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January', 'February',
  'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December', 'Mercury', 'Openai', 'Anthropic', 'Kashmir', 'Article', 'Covid',
]);

/**
 * Words that are never (part of) a person's name: pronouns, determiners,
 * function words, common verbs and nouns, and software/product vocabulary.
 * Any token from this set rejects the whole candidate ("Brain Graph",
 * "System Fixes User", "Married", "During", "She").
 */
const NON_NAME_TOKENS = new Set([
  // pronouns, determiners, function words
  'user', 'users', 'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'we', 'us', 'our', 'they', 'them', 'their',
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'there', 'here', 'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  'and', 'or', 'but', 'if', 'then', 'so', 'because', 'while', 'during', 'after', 'before', 'since', 'until', 'about', 'with', 'without', 'from', 'into', 'onto', 'for', 'of', 'on', 'in', 'at', 'by', 'to', 'as', 'also', 'just', 'only', 'very', 'not', 'no', 'yes', 'all', 'any', 'some', 'each', 'every', 'both', 'more', 'most', 'other', 'another', 'such',
  // common verbs / states that start sentences
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must',
  'task', 'tasks', 'node', 'active', 'full', 'three', 'two', 'one', 'four', 'five', 'recent', 'card', 'cards', 'vulnerabilities', 'downloads', 'official', 'account', 'developing', 'email', 'jira', 'creating', 'combinator', 'console', 'status', 'ready', 'completed', 'application', 'current', 'multiple', 'part', 'colab', 'includes', 'fork', 'mentioned', 'manages', 'requested', 'form', 'context', 'assigned', 'temp', 'issue', 'issues', 'next', 'real', 'progress', 'write', 'main', 'sub', 'setting', 'successfully', 'maintainers', 'new', 'old', 'first', 'last', 'daily', 'weekly', 'india', 'pakistan', 'search', 'checker', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'mercury', 'optimus',
  'married', 'working', 'works', 'worked', 'building', 'built', 'using', 'used', 'uses', 'wants', 'wanted', 'likes', 'liked', 'prefers', 'preferred', 'asked', 'asks', 'said', 'says', 'told', 'needs', 'needed', 'started', 'finished', 'created', 'updated', 'fixed', 'fixes', 'added', 'removed', 'please', 'thanks', 'thank',
  // roles and generic nouns
  'assistant', 'agent', 'agents', 'bot', 'bots', 'model', 'models', 'owner', 'admin', 'team', 'company', 'project', 'projects', 'product', 'products', 'customer', 'client', 'friend', 'friends', 'family', 'wife', 'husband', 'partner', 'mother', 'father', 'son', 'daughter', 'brother', 'sister',
  // software and product vocabulary
  'app', 'apps', 'web', 'website', 'site', 'page', 'interface', 'ui', 'ux', 'api', 'server', 'system', 'systems', 'graph', 'brain', 'memory', 'memories', 'animation', 'dashboard', 'desktop', 'mobile', 'code', 'repo', 'stack', 'cloud', 'plugin', 'plugins', 'skill', 'skills', 'chat', 'session', 'sessions', 'file', 'files', 'folder', 'data', 'database', 'feature', 'features', 'bug', 'bugs', 'fix', 'release', 'version', 'build', 'test', 'tests', 'error', 'errors', 'mode', 'settings', 'config', 'github', 'google', 'youtube', 'whatsapp', 'telegram', 'slack', 'discord', 'twitter', 'linkedin', 'battlefield', 'prime', 'architect',
]);

interface UserRelationMention {
  name: string;
  relation: string;
}

function extractUserRelationshipMentions(text: string): UserRelationMention[] {
  const mentions = new Map<string, UserRelationMention>();
  const rolePattern = Object.keys(USER_RELATION_ROLE_MAP)
    .sort((a, b) => b.length - a.length)
    .map(r => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const normalizedText = text.replace(/[\r\n]+/g, ' ').trim();

  const patterns = [
    new RegExp(`\\bmy\\s+(${rolePattern})\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,2})\\b`, 'gi'),
    new RegExp(`\\b([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,2})\\s+is\\s+my\\s+(${rolePattern})\\b`, 'gi'),
    new RegExp(`\\b([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,2})\\s*,\\s*my\\s+(${rolePattern})\\b`, 'gi'),
    new RegExp(`\\bmy\\s+(${rolePattern})\\s*,\\s*([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,2})\\b`, 'gi'),
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalizedText)) !== null) {
      const first = match[1]?.trim();
      const second = match[2]?.trim();
      if (!first || !second) continue;

      const firstIsRole = USER_RELATION_ROLE_MAP[first.toLowerCase()];
      const role = firstIsRole ? first.toLowerCase() : second.toLowerCase();
      const name = firstIsRole ? second : first;
      const relation = USER_RELATION_ROLE_MAP[role];
      if (!relation || !isLikelyHumanName(name)) continue;

      const key = name.toLowerCase();
      mentions.set(key, { name, relation });
    }
  }

  const groupedPatterns = [
    new RegExp(`\\bmy\\s+(${rolePattern})\\s+(?:is|are|named|called)\\s+([^.!?;]+)`, 'gi'),
    new RegExp(`\\b(?:our|user(?:'s)?|users?)\\s+(${rolePattern})\\s+(?:is|are|named|called|include|includes)\\s+([^.!?;]+)`, 'gi'),
    new RegExp(`\\b(${rolePattern})\\s+(?:is|are|named|called|include|includes)\\s+([^.!?;]+)`, 'gi'),
    new RegExp(`\\b(?:i|we)\\s+have\\s+(${rolePattern})\\s+([^.!?;]+)`, 'gi'),
    new RegExp(`\\b([^.!?;]+?)\\s+(?:is|are)\\s+my\\s+(${rolePattern})\\b`, 'gi'),
    new RegExp(`\\b([^.!?;]+?)\\s+(?:is|are)\\s+(?:our|user(?:'s)?)\\s+(${rolePattern})\\b`, 'gi'),
  ];

  for (const pattern of groupedPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalizedText)) !== null) {
      const first = match[1]?.trim();
      const second = match[2]?.trim();
      if (!first || !second) continue;

      const firstRole = USER_RELATION_ROLE_MAP[first.toLowerCase()];
      const roleToken = firstRole ? first.toLowerCase() : second.toLowerCase();
      const namesSegment = firstRole ? second : first;
      const relation = USER_RELATION_ROLE_MAP[roleToken];
      if (!relation) continue;

      for (const name of extractHumanNames(namesSegment)) {
        const key = name.toLowerCase();
        mentions.set(key, { name, relation });
      }
    }
  }

  return [...mentions.values()];
}

function extractHumanNames(segment: string, allowSentenceStart = false): string[] {
  const found = new Set<string>();
  const nameRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g;
  // Words capitalised somewhere OTHER than the start of a sentence: a
  // sentence-initial "Task" or "Active" is just English, not a name.
  const midSentence = new Set<string>();
  const firstWords = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = nameRegex.exec(segment)) !== null) {
    const before = segment.slice(0, match.index);
    const atStart = /(^|[.!?:;\n•\-–—(\[]\s*)$/.test(before);
    const first = match[1].split(' ')[0];
    if (atStart) firstWords.add(first);
    else midSentence.add(first);
  }
  nameRegex.lastIndex = 0;
  while ((match = nameRegex.exec(segment)) !== null) {
    const name = match[1].trim();
    if (!isLikelyHumanName(name)) continue;
    const before = segment.slice(0, match.index);
    const atStart = /(^|[.!?:;\n•\-–—(\[]\s*)$/.test(before);
    const single = !name.includes(' ');
    if (!allowSentenceStart && atStart && single && !midSentence.has(name)) continue;
    found.add(name);
  }
  return [...found.values()];
}

function isLikelyHumanName(name: string): boolean {
  if (!name || name.length < 2 || name.length > 48) return false;
  if (NON_PERSON_TERMS.has(name)) return false;
  const parts = name.split(' ').filter(Boolean);
  if (parts.some((p) => NON_NAME_TOKENS.has(p.toLowerCase()))) return false;
  if (parts.length === 1 && parts[0].length < 3) return false;
  return parts.every(part => /^[A-Z][a-z]+$/.test(part));
}

function mentionsPerson(text: string, name: string): boolean {
  if (!name) return false;
  const escaped = name
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  if (!escaped) return false;
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return regex.test(text);
}

/** `second-brain.db` → `second-brain.pre-owner-model.db`, once; never overwrites an earlier copy. */
function backupDatabase(dbPath: string): void {
  if (dbPath === ':memory:' || !existsSync(dbPath)) return;
  const backup = dbPath.replace(/\.db$/, '') + '.pre-owner-model.db';
  if (existsSync(backup)) return;
  try {
    copyFileSync(dbPath, backup);
    logger.info({ backup }, 'Second Brain: backed up before the Owner Model migration');
  } catch (err) {
    logger.warn({ err, backup }, 'Second Brain: backup before migration failed (continuing)');
  }
}

/** Memory types the old API speaks ↔ belief kinds (ADR-026). */
function kindToType(kind: BeliefKind): UserMemoryType {
  switch (kind) {
    case 'fact': return 'identity';
    case 'trait': return 'habit';
    case 'situation': return 'episode';
    default: return kind;
  }
}

function typeToKinds(type: UserMemoryType): BeliefKind[] {
  switch (type) {
    case 'identity': return ['fact'];
    case 'habit': return ['trait'];
    case 'constraint': return ['preference'];
    case 'decision': return ['episode'];
    case 'episode': return ['episode', 'situation'];
    case 'reflection': return [];
    default: return [type];
  }
}

export { isLikelyHumanName };

function parseMeta(raw: string | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(raw ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
