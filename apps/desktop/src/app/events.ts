/* ═══════════════════════════════════════════════════════════════
   Live events from the runtime → app state. One chat stream (scoped to
   the active thread) and one bots stream, for as long as a connection is
   up. Every view reads the stores; nothing polls for what streams.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect } from "react";
import { openStream } from "~/api/stream";
import * as api from "~/api/mercury";
import type { BotActivityEvent, ChatMessage, PendingPrompt } from "~/api/types";
import { useBots, useChat, useRuntimeState } from "./store";

export function useRuntimeEvents(enabled: boolean): void {
  const activeId = useChat((s) => s.activeId);

  useEffect(() => {
    if (!enabled) return;
    const runtime = useRuntimeState.getState();
    const query = activeId ? `?sessionId=${encodeURIComponent(activeId)}` : "";
    const stream = openStream(`/api/chat/events${query}`, {
      onOpen: () => useRuntimeState.getState().setConnected(true),
      onClose: (reason) => { if (reason !== "closed") useRuntimeState.getState().setConnected(false); },
      onEvent: (event, raw) => handleChatEvent(event, raw),
    });
    runtime.setAgent(runtime.connected ? runtime.agent : "idle");
    return () => stream.close();
  }, [enabled, activeId]);

  useEffect(() => {
    if (!enabled) return;
    const stream = openStream("/api/bots/events", {
      onEvent: (event, raw) => {
        if (event !== "bot_activity") return;
        const ev = safeJson<BotActivityEvent>(raw);
        if (!ev || ev.kind === "thinking") return;
        useBots.getState().setActivity(ev.botId, ev.kind === "turn-end" ? null : ev.label);
        if (ev.kind === "turn-end" || ev.kind === "turn-start") void refreshBots();
      },
    });
    return () => stream.close();
  }, [enabled]);
}

function safeJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function handleChatEvent(event: string, raw: string): void {
  const rt = useRuntimeState.getState();
  const chat = useChat.getState();
  const data = safeJson<Record<string, unknown>>(raw) ?? {};
  switch (event) {
    case "connected":
    case "provider":
      rt.setProvider(String(data.provider ?? ""), String(data.model ?? ""));
      break;
    case "thinking":
      rt.setAgent("thinking");
      break;
    case "step_start":
    case "step_done":
      rt.setStep({ total: Number(data.totalSteps ?? 0), current: Number(data.stepNumber ?? 0), tool: String(data.tool ?? "") });
      rt.setAgent("working");
      break;
    case "text_delta":
      rt.setAgent("streaming");
      chat.appendStreaming(String(data.text ?? ""));
      break;
    case "text_done": {
      const text = String(data.fullText ?? data.text ?? raw);
      chat.clearStreaming();
      chat.addMessage({ id: crypto.randomUUID(), role: "assistant", content: text, timestamp: new Date().toISOString() });
      rt.setStep(null);
      rt.setAgent(rt.prompts.length ? "needs-you" : "idle");
      void refreshThreads();
      break;
    }
    case "permission_request":
      rt.addPrompt(toPrompt("permission", data, String(data.prompt ?? "")));
      break;
    case "permission_continue":
      rt.addPrompt(toPrompt("continue", data, String(data.question ?? "")));
      break;
    case "choice_prompt":
      rt.addPrompt(toPrompt("choice", data, String(data.question ?? "")));
      break;
    case "permission_resolved":
    case "choice_resolved":
      if (typeof data.id === "string") rt.removePrompt(data.id);
      break;
    case "error": {
      const message = typeof data.message === "string" ? data.message : raw || "Something went wrong";
      chat.clearStreaming();
      rt.setStep(null);
      rt.setAgent("idle");
      chat.addMessage({ id: crypto.randomUUID(), role: "system", content: message, timestamp: new Date().toISOString() });
      break;
    }
    default:
      break;
  }
}

function toPrompt(kind: PendingPrompt["kind"], data: Record<string, unknown>, text: string): PendingPrompt {
  const rawOptions = Array.isArray(data.options) ? data.options : [];
  const options = rawOptions.map((o) => {
    if (typeof o === "string") return { value: o, label: labelFor(o) };
    const obj = o as { value?: string; label?: string };
    return { value: String(obj.value ?? ""), label: String(obj.label ?? obj.value ?? "") };
  });
  return { id: String(data.id ?? crypto.randomUUID()), kind, text, options, targetId: typeof data.targetId === "string" ? data.targetId : undefined, raisedAt: Date.now() };
}

function labelFor(value: string): string {
  switch (value) {
    case "yes": return "Allow";
    case "always": return "Always allow";
    case "no": return "Deny";
    default: return value;
  }
}

export async function refreshThreads(): Promise<void> {
  try {
    const { threads } = await api.chat.threads();
    useChat.getState().setThreads(threads);
  } catch { /* offline: keep what we have */ }
}

export async function refreshBots(): Promise<void> {
  try {
    const { bots, available } = await api.bots.list();
    useBots.getState().setBots(bots, available);
  } catch { /* bots unavailable on this runtime */ }
}

export async function openThread(id: string | null): Promise<void> {
  const chat = useChat.getState();
  chat.setActive(id);
  chat.clearStreaming();
  if (!id) {
    chat.setMessages([]);
    return;
  }
  chat.setLoading(true);
  try {
    const thread = await api.chat.thread(id);
    useChat.getState().setMessages(thread.messages ?? []);
  } catch {
    useChat.getState().setMessages([]);
  } finally {
    useChat.getState().setLoading(false);
  }
}

export async function sendMessage(content: string, attachments: Array<{ name: string; data: string; mime?: string }> = []): Promise<void> {
  const chat = useChat.getState();
  const rt = useRuntimeState.getState();
  let id = chat.activeId;
  if (!id) {
    const thread = await api.chat.createThread();
    id = thread.id;
    chat.setActive(id);
    chat.setMessages([]);
  }
  const shown = content || `(Attached: ${attachments.map((a) => a.name).join(", ")})`;
  const optimistic: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: shown,
    timestamp: new Date().toISOString(),
    ...(attachments.length
      ? { attachments: attachments.map((a) => ({ name: a.name, kind: a.mime?.startsWith("image/") ? "image" : "document", mime: a.mime, src: a.mime?.startsWith("image/") ? `data:${a.mime};base64,${a.data}` : undefined })) }
      : {}),
  };
  useChat.getState().addMessage(optimistic);
  rt.setAgent("thinking");
  await api.chat.send(content, id, attachments.map(({ name, data }) => ({ name, data })));
  void refreshThreads();
}

export async function answerPrompt(prompt: PendingPrompt, value: string | null): Promise<void> {
  await api.chat.answer(prompt.id, value ?? "", prompt.targetId);
  useRuntimeState.getState().removePrompt(prompt.id);
}
