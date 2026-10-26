/* ═══════════════════════════════════════════════════════════════
   App state. Views are all mounted at once and switched by `view`, so
   moving between Chat, Code, Bots, Plugins and Skills is a state change,
   never a page load.
   ═══════════════════════════════════════════════════════════════ */

import { create } from "zustand";
import type { BotStatus, ChatMessage, ChatThread, PendingPrompt } from "~/api/types";

export type View = "chat" | "code" | "bots" | "plugins" | "skills" | "settings";

/** What the agent is doing right now; drives the StateOrb everywhere. */
export type AgentState = "idle" | "thinking" | "streaming" | "working" | "needs-you" | "offline";

interface UiState {
  view: View;
  setView(view: View): void;
  sidebar: boolean;
  toggleSidebar(): void;
}

export const useUi = create<UiState>((set) => ({
  view: "chat",
  setView: (view) => set({ view }),
  sidebar: true,
  toggleSidebar: () => set((s) => ({ sidebar: !s.sidebar })),
}));

interface RuntimeState {
  connected: boolean;
  agent: AgentState;
  provider: string;
  model: string;
  step: { total: number; current: number; tool: string } | null;
  prompts: PendingPrompt[];
  setConnected(connected: boolean): void;
  setAgent(agent: AgentState): void;
  setProvider(provider: string, model: string): void;
  setStep(step: RuntimeState["step"]): void;
  addPrompt(prompt: PendingPrompt): void;
  removePrompt(id: string): void;
}

export const useRuntimeState = create<RuntimeState>((set, get) => ({
  connected: false,
  agent: "offline",
  provider: "",
  model: "",
  step: null,
  prompts: [],
  setConnected: (connected) => set({ connected, agent: connected ? (get().agent === "offline" ? "idle" : get().agent) : "offline" }),
  setAgent: (agent) => set({ agent }),
  setProvider: (provider, model) => set({ provider, model }),
  setStep: (step) => set({ step }),
  addPrompt: (prompt) => set((s) => ({ prompts: [...s.prompts.filter((p) => p.id !== prompt.id), prompt], agent: "needs-you" })),
  removePrompt: (id) => set((s) => {
    const prompts = s.prompts.filter((p) => p.id !== id);
    return { prompts, agent: prompts.length === 0 && s.agent === "needs-you" ? "working" : s.agent };
  }),
}));

interface ChatState {
  threads: ChatThread[];
  activeId: string | null;
  messages: ChatMessage[];
  streaming: string;
  loading: boolean;
  setThreads(threads: ChatThread[]): void;
  setActive(id: string | null): void;
  setMessages(messages: ChatMessage[]): void;
  addMessage(message: ChatMessage): void;
  appendStreaming(text: string): void;
  clearStreaming(): void;
  setLoading(loading: boolean): void;
}

export const useChat = create<ChatState>((set) => ({
  threads: [],
  activeId: null,
  messages: [],
  streaming: "",
  loading: false,
  setThreads: (threads) => set({ threads }),
  setActive: (activeId) => set({ activeId }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  appendStreaming: (text) => set((s) => ({ streaming: s.streaming + text })),
  clearStreaming: () => set({ streaming: "" }),
  setLoading: (loading) => set({ loading }),
}));

interface BotsState {
  bots: BotStatus[];
  available: boolean;
  activity: Record<string, string>;
  setBots(bots: BotStatus[], available: boolean): void;
  setActivity(botId: string, label: string | null): void;
}

export const useBots = create<BotsState>((set) => ({
  bots: [],
  available: true,
  activity: {},
  setBots: (bots, available) => set({ bots, available }),
  setActivity: (botId, label) => set((s) => {
    const activity = { ...s.activity };
    if (label === null) delete activity[botId];
    else activity[botId] = label;
    return { activity };
  }),
}));
