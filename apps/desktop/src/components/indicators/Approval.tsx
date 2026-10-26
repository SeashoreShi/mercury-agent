import { useState } from "react";
import { cx } from "~/lib/cx";
import type { PendingPrompt } from "~/api/types";
import { Button } from "~/components/ui/Button";
import { Kbd } from "~/components/ui/bits";

/**
 * "Needs you": a prompt the runtime raised and is waiting on. One card for
 * all three kinds (tool permission, continue?, pick one). The amber edge is
 * the only colour; the first option is the primary action.
 */
export function Approval({ prompt, onAnswer, compact }: { prompt: PendingPrompt; onAnswer: (value: string | null) => Promise<void> | void; compact?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function answer(value: string | null) {
    setBusy(value ?? "__cancel");
    try {
      await onAnswer(value);
    } finally {
      setBusy(null);
    }
  }
  const title = prompt.kind === "permission" ? "Allow this?" : prompt.kind === "continue" ? "Keep going?" : "Your pick";
  return (
    <div className={cx("rounded-lg border border-amber/40 bg-amber/[0.06] p-3", compact && "p-2.5")} role="group" aria-label={title}>
      <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-amber">
        <span className="block h-1.5 w-1.5 rounded-full bg-amber" aria-hidden="true" />
        {title}
      </div>
      <pre className="mb-3 whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-ink" data-selectable>{prompt.text}</pre>
      <div className="flex flex-wrap items-center gap-1.5">
        {prompt.options.map((o, i) => (
          <Button key={o.value} size="sm" variant={i === 0 ? "primary" : "outline"} loading={busy === o.value} disabled={busy !== null} onClick={() => void answer(o.value)}>
            {o.label}
          </Button>
        ))}
        {prompt.kind === "choice" && (
          <Button size="sm" variant="ghost" loading={busy === "__cancel"} disabled={busy !== null} onClick={() => void answer(null)}>
            Cancel
          </Button>
        )}
        {!compact && <span className="ml-auto hidden items-center gap-1 text-2xs text-ink4 sm:inline-flex"><Kbd>Y</Kbd> allow <Kbd>N</Kbd> deny</span>}
      </div>
    </div>
  );
}
