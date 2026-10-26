import { memo } from "react";
import type { ChatMessage } from "~/api/types";
import { Mark } from "~/components/Logo";
import { Markdown } from "~/components/Markdown";
import { StreamCaret } from "~/components/indicators/Thinking";
import { ActionResult } from "~/components/indicators/Activity";

/**
 * No bubbles. The user's turn reads like a heading; the agent's answer is
 * prose beneath it, with the mark in the gutter. System notes are muted.
 */
export const Message = memo(function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="pl-9">
        <p className="whitespace-pre-wrap text-md font-medium leading-relaxed tracking-[-0.005em] text-ink" data-selectable>{message.content}</p>
      </div>
    );
  }
  if (message.role === "system") {
    return (
      <div className="pl-9">
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink3" data-selectable>{message.content}</p>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <span className="mt-[3px] flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true"><Mark size={20} /></span>
      <div className="min-w-0 flex-1">
        {message.steps && message.steps.length > 0 && (
          <div className="mb-2 flex flex-col gap-1">
            {message.steps.map((s, i) => <ActionResult key={i} tool={s.tool} status={s.status} detail={s.result} />)}
          </div>
        )}
        <Markdown text={message.content} />
      </div>
    </div>
  );
});

export function StreamingMessage({ text }: { text: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-[3px] flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true"><Mark size={20} /></span>
      <div className="min-w-0 flex-1">
        <Markdown text={text} />
        <StreamCaret />
      </div>
    </div>
  );
}
