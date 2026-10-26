/* The second brain's endpoints (beliefs, people, graph, checks). */

import { http } from "./client";

export interface BrainMemory {
  id: string;
  type: string;
  summary: string;
  detail: string | null;
  scope?: string;
  evidenceKind?: string;
  source?: string;
  confidence: number;
  importance: number;
  evidenceCount?: number;
  dismissed?: boolean;
  createdAt: number;
  updatedAt: number;
  lastSeenAt?: number;
}

export interface PersonMeta {
  phone?: string;
  email?: string;
  birthday?: string;
  location?: string;
  company?: string;
  role?: string;
  notes?: string;
  links?: string[];
}

export interface BrainPerson {
  id: string;
  name: string;
  canonicalName: string;
  relationship?: string;
  summary?: string;
  confidence: number;
  memoryCount: number;
  kind: "person" | "pet" | "unverified";
  verifiedBy: "owner" | "model" | "model-rejected" | null;
  meta: PersonMeta;
  ownerEdited: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  connections?: Array<{ id: string; name?: string; display_name?: string; relation_type?: string; strength?: number }>;
}

export interface BrainGraphData {
  persons: Array<{ id: string; name: string; kind: string; relationship: string | null; memoryCount: number }>;
  memories: Array<{ id: string; summary: string; type: string; importance: number; updatedAt: number }>;
  memoryPersons: Array<{ memoryId: string; personId: string; role: string }>;
  relationships: Array<{ source: string; target: string; type: string; strength: number }>;
  available: boolean;
}

export interface CheckStatus {
  enabled: boolean;
  pending: number;
  callsToday: number;
  dailyCap: number;
  lastRunAt: number | null;
  lastError: string | null;
  nextRunAt: number | null;
  checked: number;
}

export const MEMORY_TYPES = ["identity", "preference", "goal", "project", "habit", "decision", "constraint", "relationship", "episode", "reflection"] as const;

export const brain = {
  status: () => http.get<{ available: boolean; total?: number }>("/api/brain/status"),
  memories: (opts: { limit?: number; offset?: number; type?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.limit) qs.set("limit", String(opts.limit));
    if (opts.offset) qs.set("offset", String(opts.offset));
    if (opts.type) qs.set("type", opts.type);
    if (opts.q) qs.set("q", opts.q);
    return http.get<{ memories: BrainMemory[]; total: number }>(`/api/brain/memory?${qs}`);
  },
  search: (q: string, limit = 40) => http.get<{ memories: BrainMemory[] }>(`/api/brain/memory/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  memory: (id: string) => http.get<BrainMemory>(`/api/brain/memory/${encodeURIComponent(id)}`),
  updateMemory: (id: string, patch: Partial<Pick<BrainMemory, "summary" | "detail" | "importance" | "confidence">>) => http.put<{ success: boolean }>(`/api/brain/memory/${encodeURIComponent(id)}`, patch),
  deleteMemory: (id: string) => http.delete<{ success: boolean }>(`/api/brain/memory/${encodeURIComponent(id)}`),
  addMemory: (body: { type: string; summary: string; detail?: string }) => http.post<BrainMemory>("/api/brain/memory", body),

  persons: (opts: { q?: string; kind?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.q) qs.set("q", opts.q);
    if (opts.kind) qs.set("kind", opts.kind);
    qs.set("limit", String(opts.limit ?? 200));
    return http.get<{ persons: BrainPerson[] }>(`/api/brain/persons?${qs}`);
  },
  person: (id: string) => http.get<{ person: BrainPerson }>(`/api/brain/persons/${encodeURIComponent(id)}`),
  personMemories: (id: string) => http.get<{ memories: BrainMemory[] }>(`/api/brain/persons/${encodeURIComponent(id)}/memories?limit=60`),
  updatePerson: (id: string, patch: { name?: string; relationship?: string | null; summary?: string | null; kind?: string; meta?: PersonMeta }) =>
    http.patch<{ person?: BrainPerson; removed?: boolean }>(`/api/brain/persons/${encodeURIComponent(id)}`, patch),
  mergePerson: (id: string, into: string) => http.post<{ person: BrainPerson | null }>(`/api/brain/persons/${encodeURIComponent(id)}/merge`, { into }),
  notAPerson: (id: string) => http.patch<{ removed?: boolean }>(`/api/brain/persons/${encodeURIComponent(id)}`, { kind: "not_person" }),

  checks: () => http.get<CheckStatus>("/api/brain/persons/checks"),
  runCheck: () => http.post<{ checked: number; status: CheckStatus }>("/api/brain/persons/checks/run"),
  queueExisting: () => http.post<{ queued: number; status: CheckStatus | null }>("/api/brain/persons/checks/queue-existing"),

  graph: (memories = 300) => http.get<BrainGraphData>(`/api/brain/graph/v2?memories=${memories}`),
};
