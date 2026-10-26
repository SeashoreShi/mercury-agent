import { PanelLeft, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
const PAGE = 30;

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
  // Render only the newest PAGE messages; older ones come in a page at a
  // time when the reader scrolls near the top, keeping their place.
  const [visible, setVisible] = useState(PAGE);
  const prepend = useRef<{ height: number; top: number } | null>(null);
  useEffect(() => { setVisible(PAGE); stickToBottom.current = true; }, [activeId]);
  const shown = messages.length > visible ? messages.slice(messages.length - visible) : messages;
  const hiddenCount = messages.length - shown.length;
  useLayoutEffect(() => {
    const el = scroller.current;
    const p = prepend.current;
    if (!el || !p) return;
    el.scrollTop = p.top + (el.scrollHeight - p.height);
    prepend.current = null;
  }, [visible]);
  function loadEarlier() {
    const el = scroller.current;
    if (!el || hiddenCount <= 0) return;
    prepend.current = { height: el.scrollHeight, top: el.scrollTop };
    setVisible((v) => v + PAGE);
  }

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
        <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3" data-tauri-drag-region>
          {mode === "chat" && (
            <Tooltip label={sidebar ? "Hide threads" : "Show threads"} shortcut="⌘B" side="bottom">
              <Button variant="ghost" size="sm" icon onClick={toggleSidebar} aria-label="Toggle threads"><PanelLeft size={16} /></Button>
            </Tooltip>
          )}
          <div className="min-w-0 flex-1 truncate text-base font-medium text-ink">{header ?? title}</div>
          <StateLabel state={agent} detail={step?.tool ? `${step.tool}${step.total ? ` ${step.current}/${step.total}` : ""}` : undefined} />
          {mode === "chat" && (
            <Tooltip label="New thread" shortcut="⌘N" side="bottom">
              <Button variant="ghost" size="sm" icon onClick={() => void openThread(null)} aria-label="New thread"><Plus size={16} /></Button>
            </Tooltip>
          )}
        </header>

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            if (el.scrollTop < 160 && hiddenCount > 0 && !prepend.current) loadEarlier();
          }}
          className={cx("min-h-0 flex-1 overflow-y-auto", empty && "flex items-center justify-center")}
        >
          {empty ? (
            <EmptyPrompt mode={mode} />
          ) : (
            <div className="mx-auto flex w-full max-w-[780px] flex-col gap-7 px-8 py-8">
              {loading && messages.length === 0 && <ThinkingDots label="Loading" />}
              {hiddenCount > 0 && (
                <button onClick={loadEarlier} className="self-center rounded-full border border-line px-3 py-1 text-xs text-ink3 hover:text-ink">
                  {hiddenCount} earlier message{hiddenCount === 1 ? "" : "s"}
                </button>
              )}
              {shown.map((m) => <Message key={m.id} message={m} />)}
              {streaming && <StreamingMessage text={streaming} />}
              {!streaming && (agent === "thinking" || agent === "working") && (
                <ThinkingDots label={agent === "working" && step?.tool ? `Running ${step.tool}` : "Thinking"} className="pl-10" />
              )}
              {prompts.map((p) => (
                <div key={p.id} className="pl-10">
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
      <div className="text-2xl font-medium tracking-tight text-ink">{mode === "code" ? "What should we build?" : "What's on your mind?"}</div>
      <p className="max-w-[460px] text-base text-ink3">
        {mode === "code" ? "Mercury works in your workspace: reads, edits, runs, and asks before anything that can't be undone." : "Ask, delegate, or think out loud. Mercury remembers what matters."}
      </p>
    </div>
  );
}
