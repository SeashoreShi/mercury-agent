/**
 * The API contract between a Mercury runtime and every client that is not
 * shipped inside the same binary: Mercury Desktop, the phone apps, scripts.
 *
 * Two numbers exist and they move independently:
 *
 *  - the PACKAGE version (`package.json`, `/api/health.version`) — what to
 *    print in an About box and what `mercury upgrade` compares;
 *  - the API VERSION (`API_VERSION`, `/api/health.apiVersion`) — a single
 *    integer bumped ONLY on a change a client cannot tolerate: a removed or
 *    renamed route, a changed response shape, a changed auth scheme.
 *
 * Additive changes never bump the integer. They add a FEATURE flag instead,
 * and clients gate UI on the flag. A client declares the range of API
 * versions it understands; outside that range it tells the user to update
 * one side or the other. `docs/api-contract.md` records which runtime
 * release introduced each version.
 */

export const API_VERSION = 1;

/**
 * Capabilities a client may rely on. Order is irrelevant; names are stable
 * once published (remove = bump API_VERSION).
 */
export const API_FEATURES: readonly string[] = Object.freeze([
  'auth.devices',      // device tokens: POST /api/auth/token, GET/DELETE /api/auth/devices
  'chat.sse',          // GET /api/chat/events (Server-Sent Events)
  'chat.attachments',  // multipart uploads on POST /api/chat/send
  'bots',              // /api/bots/*
  'plugins',           // /api/plugins/*
  'mcp',               // /api/mcp/*
  'boards',            // /api/boards/*
  'brain',             // /api/brain/*
  'code.session',      // POST /api/chat/send { programming, cwd } — per-session coding
  'chat.uploads',      // attachments on messages + GET /api/chat/uploads/:month/:file
  'voice',             // /api/voice, /api/voice/events, /api/voice/control (Optimus)
  'usage.history',     // GET /api/usage/history?days= — tokens per local day
  'brain.people',      // PATCH/merge persons, person checks, GET /api/brain/graph/v2
]);

export interface ApiContractInfo {
  apiVersion: number;
  features: readonly string[];
}

export function apiContract(): ApiContractInfo {
  return { apiVersion: API_VERSION, features: API_FEATURES };
}
