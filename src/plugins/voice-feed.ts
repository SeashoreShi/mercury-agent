/**
 * Live voice sessions of a desktop plugin (Optimus), for clients that show
 * them: Mercury Desktop's notch capsule, status bar and the live voice chat.
 *
 * The channel bridge feeds it (activity, what the owner asked, what Mercury
 * answered, what it is doing, approvals, the end of the session); the web
 * API reads it and streams changes. Controls go the other way: the bridge
 * registers a sender, and POST /api/voice/control calls it.
 *
 * In-memory only: a voice session is live state. The conversation itself is
 * already kept by the session store like any other turn.
 */

export type VoiceRole = 'owner' | 'mercury' | 'activity' | 'approval' | 'system';

export interface VoiceTurn {
  id: number;
  role: VoiceRole;
  text: string;
  at: number;
}

export interface VoiceState {
  available: boolean;
  plugin: string | null;
  active: boolean;
  callId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  listening: boolean;
  speaking: boolean;
  working: boolean;
  muted: boolean;
  /** A question is being answered (a Mercury turn is running). */
  thinking: boolean;
  activity: string | null;
  outcome: string | null;
  turns: VoiceTurn[];
}

export type VoiceAction = 'mute' | 'unmute' | 'interrupt' | 'stop';
export const VOICE_ACTIONS: readonly VoiceAction[] = ['mute', 'unmute', 'interrupt', 'stop'];

type Listener = (event: { type: 'state' | 'turn'; state: VoiceState; turn?: VoiceTurn }) => void;

const MAX_TURNS = 200;

class VoiceFeed {
  private state: VoiceState = {
    available: false, plugin: null, active: false, callId: null, startedAt: null, endedAt: null,
    listening: false, speaking: false, working: false, muted: false, thinking: false, activity: null, outcome: null, turns: [],
  };
  private seq = 0;
  private listeners = new Set<Listener>();
  private controller: ((action: VoiceAction) => void) | null = null;

  snapshot(): VoiceState {
    return { ...this.state, turns: [...this.state.turns] };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The desktop plugin's bridge: its name, and how to send it a control. */
  attach(plugin: string, controller: (action: VoiceAction) => void): void {
    this.controller = controller;
    this.patch({ available: true, plugin });
  }

  detach(plugin: string): void {
    if (this.state.plugin !== plugin) return;
    this.controller = null;
    this.patch({ available: false, listening: false, speaking: false, working: false, muted: false, thinking: false, active: false });
  }

  control(action: VoiceAction): boolean {
    if (!this.controller || !this.state.active) return false;
    this.controller(action);
    return true;
  }

  started(callId: string): void {
    if (this.state.active && this.state.callId === callId) return;
    this.patch({ active: true, callId, startedAt: Date.now(), endedAt: null, outcome: null, thinking: false, activity: null, turns: [] });
  }

  activity(p: { listening: boolean; working: boolean; muted: boolean; speaking?: boolean }): void {
    const next: Partial<VoiceState> = { listening: p.listening, working: p.working, muted: p.muted, speaking: p.speaking === true };
    // A session the plugin started without a call (e.g. after a restart) still shows.
    if (p.listening && !this.state.active) Object.assign(next, { active: true, startedAt: Date.now(), endedAt: null, turns: [] });
    this.patch(next);
  }

  asked(callId: string, question: string): void {
    this.started(callId);
    this.patch({ thinking: true, activity: null });
    this.push('owner', question);
  }

  doing(activity: string): void {
    if (!this.state.active) return;
    this.patch({ activity });
    this.push('activity', activity);
  }

  answered(answer: string): void {
    if (!this.state.active) return;
    this.patch({ thinking: false, activity: null });
    this.push('mercury', answer);
  }

  approval(prompt: string): void {
    if (!this.state.active) return;
    this.push('approval', prompt);
  }

  ended(callId: string, outcome: string): void {
    if (this.state.callId && callId && this.state.callId !== callId) return;
    this.patch({ active: false, listening: false, speaking: false, thinking: false, activity: null, endedAt: Date.now(), outcome });
  }

  /** Test hook. */
  reset(): void {
    this.controller = null;
    this.seq = 0;
    this.state = { ...this.state, available: false, plugin: null, active: false, callId: null, startedAt: null, endedAt: null, listening: false, speaking: false, working: false, muted: false, thinking: false, activity: null, outcome: null, turns: [] };
  }

  private push(role: VoiceRole, text: string): void {
    const turn: VoiceTurn = { id: ++this.seq, role, text: text.slice(0, 4000), at: Date.now() };
    const turns = [...this.state.turns, turn];
    this.state = { ...this.state, turns: turns.length > MAX_TURNS ? turns.slice(-MAX_TURNS) : turns };
    this.emit({ type: 'turn', state: this.snapshot(), turn });
  }

  private patch(next: Partial<VoiceState>): void {
    const before = JSON.stringify(this.withoutTurns(this.state));
    this.state = { ...this.state, ...next };
    if (JSON.stringify(this.withoutTurns(this.state)) !== before || next.turns) this.emit({ type: 'state', state: this.snapshot() });
  }

  private withoutTurns(s: VoiceState): Omit<VoiceState, 'turns'> {
    const { turns: _turns, ...rest } = s;
    return rest;
  }

  private emit(event: Parameters<Listener>[0]): void {
    for (const l of this.listeners) {
      try { l(event); } catch { /* a listener's bug must not stop the feed */ }
    }
  }
}

export const voiceFeed = new VoiceFeed();
