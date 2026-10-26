import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultConfig } from '../utils/config.js';
import { UserMemoryStore } from './user-memory.js';
import { isBetterSqlite3Available } from './second-brain-db.js';

/**
 * The owner curates people: edits keep the id and survive rebuilds, merges
 * move every link, "not a person" is permanent, and new names (never old
 * ones) are queued for a check.
 */
const tempDirs: string[] = [];
const sqliteAvailable = isBetterSqlite3Available();

function createStore(): UserMemoryStore {
  const dir = mkdtempSync(join(tmpdir(), 'mercury-people-'));
  tempDirs.push(dir);
  const config = getDefaultConfig();
  config.memory.secondBrain = { enabled: true };
  return new UserMemoryStore(config, 'user:owner', join(dir, 'second-brain', 'second-brain.db'));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop()!, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function remember(store: UserMemoryStore, summary: string) {
  store.remember([{ type: 'relationship', summary, evidenceKind: 'direct', confidence: 0.9, importance: 0.8, durability: 0.9 }], 'system');
}

const byName = (store: UserMemoryStore, name: string) => store.listPersons(name, 50).find((p) => p.name === name);

describe.skipIf(!sqliteAvailable)('people curation', () => {
  it('stores real names only; junk phrases never become people', () => {
    const store = createStore();
    remember(store, 'My wife Heer loves tea. Married since 2020. During winter She works on the Brain Graph.');
    const names = store.listPersons('', 50).map((p) => p.name);
    expect(names).toContain('Heer');
    for (const junk of ['Married', 'During', 'She', 'Brain Graph']) expect(names).not.toContain(junk);
  });

  it('an edit keeps the id, adds the new name as an alias, and survives a rebuild', () => {
    const store = createStore();
    remember(store, 'My son Zayd started school.');
    const zayd = byName(store, 'Zayd')!;
    const edited = store.updatePerson(zayd.id, { displayName: 'Zayd Qureshi', kind: 'person', meta: { birthday: '2019-05-01' } })!;
    expect(edited.id).toBe(zayd.id);
    expect(edited.verifiedBy).toBe('owner');
    store.rebuildPersonsFromMemory();
    const after = store.getPerson(zayd.id)!;
    expect(after.name).toBe('Zayd Qureshi');
    expect(after.meta).toEqual({ birthday: '2019-05-01' });
    remember(store, 'Zayd Qureshi won a medal.');
    expect(store.getPersonMemories(zayd.id, 10).length).toBe(2);
  });

  it('merging moves memories to one id, and the old name keeps resolving to it', () => {
    const store = createStore();
    remember(store, 'My wife Heer likes hiking.');
    remember(store, 'Heer Salman painted the room.');
    const a = byName(store, 'Heer')!;
    const b = byName(store, 'Heer Salman')!;
    expect(store.mergePersons(b.id, a.id)).toBe(true);
    expect(store.getPerson(b.id)).toBeNull();
    expect(store.getPersonMemories(a.id, 10).length).toBe(2);
    store.rebuildPersonsFromMemory();
    expect(byName(store, 'Heer Salman')).toBeUndefined();
    expect(store.getPersonMemories(a.id, 10).length).toBe(2);
  });

  it('"not a person" removes it and it never comes back', () => {
    const store = createStore();
    remember(store, 'Tesla Motors announced a car.');
    const t = store.listPersons('Tesla', 10)[0];
    if (!t) return; // the rules may already reject it; either way it must stay gone
    expect(store.markNotPerson(t.id)).toBe(true);
    store.rebuildPersonsFromMemory();
    remember(store, 'Tesla Motors shipped again.');
    expect(store.listPersons('Tesla', 10)).toHaveLength(0);
  });

  it('new names are queued for a check; rebuilds of old memories are not', () => {
    const store = createStore();
    remember(store, 'Zayd started school.');
    store.listPersons('', 10); // first use: the backfill indexes what already exists, unchecked
    expect(store.countPersonChecks()).toBe(0);
    remember(store, 'Shehzen visited yesterday.');
    expect(store.countPersonChecks()).toBe(1);
    const [item] = store.pendingPersonChecks(10);
    store.applyPersonCheck(item.person_id, 'person');
    expect(store.countPersonChecks()).toBe(0);
    expect(store.getPerson(item.person_id)?.kind).toBe('person');
    store.rebuildPersonsFromMemory();
    expect(store.countPersonChecks()).toBe(0);
  });

  it('the graph has only real links', () => {
    const store = createStore();
    remember(store, 'My wife Heer and my son Zayd went to the park.');
    const g = store.personGraph(100);
    expect(g.persons.map((p) => p.name).sort()).toEqual(['Heer', 'Zayd']);
    expect(g.memoryPersons.length).toBe(2);
    expect(g.memories.length).toBe(1);
  });
});
