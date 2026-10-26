import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "~/lib/cx";
import { useConversation, useConversationStore } from "~/app/conversation";
import { answerPrompt } from "~/app/events";
import { StateLabel } from "~/components/indicators/StateOrb";
import { Approval } from "~/components/indicators/Approval";
import { ThinkingDots } from "~/components/indicators/Thinking";
import { Message, StreamingMessage } from "./Message";
import { Composer, type ComposerProps } from "./Composer";

const PAGE = 30;

/**
 * One conversation column: header, messages (newest PAGE, older on
 * scroll-up with the place kept), approvals, composer. It reads the
 * surface it is rendered in (ConversationContext), so Chat and Code use
 * the same component without sharing any state.
 */
export function Conversation({ header, empty, composer }: { header: ReactNode; empty: ReactNode; composer: ComposerProps }) {
  const store = useConversationStore();
  const messages = useConversation((s) => s.messages);
  const streaming = useConversation((s) => s.streaming);
  const loading = useConversation((s) => s.loading);
  const activeId = useConversation((s) => s.activeId);
  const agent = useConversation((s) => s.agent);
  const step = useConversation((s) => s.step);
  const prompts = useConversation((s) => s.prompts);
  const live = useConversation((s) => s.live);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
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
  useEffect(() => {
    const el = scroller.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming, prompts.length, loading, live]);

  const isEmpty = !activeId && messages.length === 0 && !streaming;

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4" data-tauri-drag-region>
        <div className="flex min-w-0 flex-1 items-center gap-3">{header}</div>
        <StateLabel state={agent} detail={step?.tool ? `${step.tool}${step.total ? ` ${step.current}/${step.total}` : ""}` : undefined} />
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (el.scrollTop < 160 && hiddenCount > 0 && !prepend.current) loadEarlier();
        }}
        className={cx("min-h-0 flex-1 overflow-y-auto", isEmpty && "flex flex-col")}
      >
        {/* Centred with auto margins, not justify-center: when the start screen
            is taller than the window, justify-center pushes its top under the
            header where it can't be scrolled to. Auto margins collapse instead. */}
        {isEmpty ? <div className="m-auto flex w-full justify-center py-8">{empty}</div> : (
          <div className="mx-auto flex w-full max-w-[780px] flex-col gap-7 px-8 py-8">
            {loading && messages.length === 0 && <ThinkingDots label="Loading" />}
            {hiddenCount > 0 && (
              <button onClick={loadEarlier} className="self-center rounded-full border border-line px-3 py-1 text-xs text-ink3 hover:text-ink">
                {hiddenCount} earlier message{hiddenCount === 1 ? "" : "s"}
              </button>
            )}
            {shown.map((m) => <Message key={m.id} message={m} />)}
            {(streaming || (live && (agent === "thinking" || agent === "working" || agent === "streaming" || agent === "needs-you"))) && (
              <StreamingMessage text={streaming} live={live} />
            )}
            {!streaming && !live && (agent === "thinking" || agent === "working") && (
              <ThinkingDots label={agent === "working" && step?.tool ? `Running ${step.tool}` : "Thinking"} className="pl-10" />
            )}
            {prompts.map((p) => (
              <div key={p.id} className="pl-10">
                <Approval prompt={p} onAnswer={(v) => answerPrompt(store, p, v)} />
              </div>
            ))}
          </div>
        )}
      </div>

      <Composer {...composer} />
    </section>
  );
}
