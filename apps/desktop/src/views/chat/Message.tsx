import { ChevronRight, Wrench } from "lucide-react";
import { memo, useState } from "react";
import type { ChatMessage } from "~/api/types";
import { Mark } from "~/components/Logo";
import { Markdown } from "~/components/Markdown";
import { StreamCaret } from "~/components/indicators/Thinking";
import { ActionResult } from "~/components/indicators/Activity";
import { cx } from "~/lib/cx";

/**
 * One entry in a conversation. Each kind the runtime stores gets its own
 * rendering:
 *  - user          a short heading-weight line, no bubble
 *  - assistant     prose (markdown) beside the mark
 *  - tool-call     a collapsed "used N tools" row; open it for each call
 *  - system        a muted note
 */
export const Message = memo(function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="pl-10 pt-2">
        <p className="whitespace-pre-wrap text-lg font-medium leading-[1.55] tracking-[-0.01em] text-ink" data-selectable>{message.content}</p>
      </div>
    );
  }
  if (message.kind === "tool-call" || message.role === "tool") {
    return <ToolActivity content={message.content} />;
  }
  if (message.role === "system") {
    return (
      <div className="pl-10">
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink3" data-selectable>{message.content}</p>
      </div>
    );
  }
  return (
    <div className="flex gap-4">
      <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true"><Mark size={22} /></span>
      <div className="min-w-0 flex-1">
        {message.steps && message.steps.length > 0 && (
          <div className="mb-3 flex flex-col gap-1">
            {message.steps.map((s, i) => <ActionResult key={i} tool={s.tool} status={s.status} detail={s.result} />)}
          </div>
        )}
        <Markdown text={message.content} />
      </div>
    </div>
  );
});

interface ToolLine {
  tool: string;
  args: string;
  status: "done" | "error";
  detail: string;
}

/** "[Tool activity …]\n- web_search query=… → ok (22 lines)" → structured rows. */
export function parseToolActivity(content: string): ToolLine[] {
  const lines: ToolLine[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("- ")) continue;
    const body = line.slice(2);
    const arrow = body.lastIndexOf("→");
    const head = arrow === -1 ? body : body.slice(0, arrow).trim();
    const tail = arrow === -1 ? "" : body.slice(arrow + 1).trim();
    const space = head.indexOf(" ");
    const tool = space === -1 ? head : head.slice(0, space);
    const args = space === -1 ? "" : head.slice(space + 1);
    const failed = /^(error|failed|denied|blocked)/i.test(tail);
    lines.push({ tool, args, status: failed ? "error" : "done", detail: tail.replace(/^ok\s*/i, "") });
  }
  return lines;
}

function ToolActivity({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const calls = parseToolActivity(content);
  if (calls.length === 0) return null;
  const names = [...new Set(calls.map((c) => c.tool))];
  const failed = calls.filter((c) => c.status === "error").length;
  return (
    <div className="pl-10">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-md py-1 text-sm text-ink3 hover:text-ink" aria-expanded={open}>
        <ChevronRight size={14} className={cx("transition-transform", open && "rotate-90")} aria-hidden="true" />
        <Wrench size={13} aria-hidden="true" />
        <span>Used {calls.length} tool{calls.length === 1 ? "" : "s"}</span>
        <span className="truncate font-mono text-xs text-ink4">{names.slice(0, 4).join(" · ")}{names.length > 4 ? " …" : ""}</span>
        {failed > 0 && <span className="text-xs text-red">{failed} failed</span>}
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-1 pl-5">
          {calls.map((c, i) => <ActionResult key={i} tool={c.tool} status={c.status} detail={[c.args, c.detail].filter(Boolean).join(" · ")} />)}
        </div>
      )}
    </div>
  );
}

export function StreamingMessage({ text }: { text: string }) {
  return (
    <div className="flex gap-4">
      <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true"><Mark size={22} /></span>
      <div className="min-w-0 flex-1">
        <Markdown text={text} />
        <StreamCaret />
      </div>
    </div>
  );
}
