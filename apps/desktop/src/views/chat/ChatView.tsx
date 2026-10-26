import { PanelLeft, Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { cx } from "~/lib/cx";
import { useChat, useRuntimeState, useUi } from "~/app/store";
import { answerPrompt, openThread } from "~/app/events";
import { Button } from "~/components/ui/Button";
import { Tooltip } from "~/components/ui/Tooltip";
import { StateLabel } from "~/components/indicators/StateOrb";
import { Approval } from "~/components/indicators/Approval";
import { ThinkingDots } from "~/components/indicators/Thinking";
import { ThreadList } from "./ThreadList";
import { Message, StreamingMessage } from "./Message";
import { Composer } from "./Composer";

/**
 * Chat: threads on the left (collapsible), one conversation in a 760px
 * column, the composer at the bottom. The same component serves Code
 * mode with a different header.
 */
export function ChatView({ mode, header }: { mode: "chat" | "code"; header?: React.ReactNode }) {
  const sidebar = useUi((s) => s.sidebar);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const messages = useChat((s) => s.messages);
  const streaming = useChat((s) => s.streaming);
  const loading = useChat((s) => s.loading);
  const activeId = useChat((s) => s.activeId);
  const threads = useChat((s) => s.threads);
  const agent = useRuntimeState((s) => s.agent);
  const step = useRuntimeState((s) => s.step);
  const prompts = useRuntimeState((s) => s.prompts);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const title = threads.find((t) => t.id === activeId)?.title || (activeId ? "Untitled" : "New thread");
  const empty = !activeId && messages.length === 0 && !streaming;

  useEffect(() => {
    const el = scroller.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming, prompts.length, loading]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n" && !e.shiftKey) { e.preventDefault(); void openThread(null); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") { e.preventDefault(); toggleSidebar(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  return (
    <div className="flex h-full min-h-0">
      {mode === "chat" && sidebar && <ThreadList />}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3" data-tauri-drag-region>
          {mode === "chat" && (
            <Tooltip label={sidebar ? "Hide threads" : "Show threads"} shortcut="⌘B" side="bottom">
              <Button variant="ghost" size="sm" icon onClick={toggleSidebar} aria-label="Toggle threads"><PanelLeft size={16} /></Button>
            </Tooltip>
          )}
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{header ?? title}</div>
          <StateLabel state={agent} detail={step?.tool ? `${step.tool}${step.total ? ` ${step.current}/${step.total}` : ""}` : undefined} />
          {mode === "chat" && (
            <Tooltip label="New thread" shortcut="⌘N" side="bottom">
              <Button variant="ghost" size="sm" icon onClick={() => void openThread(null)} aria-label="New thread"><Plus size={16} /></Button>
            </Tooltip>
          )}
        </header>

        <div
          ref={scroller}
          onScroll={(e) => { const el = e.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
          className={cx("min-h-0 flex-1 overflow-y-auto", empty && "flex items-center justify-center")}
        >
          {empty ? (
            <EmptyPrompt mode={mode} />
          ) : (
            <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-6 py-6">
              {loading && messages.length === 0 && <ThinkingDots label="Loading" />}
              {messages.map((m) => <Message key={m.id} message={m} />)}
              {streaming && <StreamingMessage text={streaming} />}
              {!streaming && (agent === "thinking" || agent === "working") && (
                <ThinkingDots label={agent === "working" && step?.tool ? `Running ${step.tool}` : "Thinking"} className="pl-9" />
              )}
              {prompts.map((p) => (
                <div key={p.id} className="pl-9">
                  <Approval prompt={p} onAnswer={(v) => answerPrompt(p, v)} />
                </div>
              ))}
            </div>
          )}
        </div>

        <Composer mode={mode} />
      </section>
    </div>
  );
}

function EmptyPrompt({ mode }: { mode: "chat" | "code" }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 pb-24 text-center">
      <div className="text-xl font-medium tracking-tight text-ink">{mode === "code" ? "What should we build?" : "What's on your mind?"}</div>
      <p className="max-w-[420px] text-sm text-ink3">
        {mode === "code" ? "Mercury works in your workspace: reads, edits, runs, and asks before anything that can't be undone." : "Ask, delegate, or think out loud. Mercury remembers what matters."}
      </p>
    </div>
  );
}
