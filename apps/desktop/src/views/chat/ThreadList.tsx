import { Trash2 } from "lucide-react";
import { useMemo } from "react";
import { cx } from "~/lib/cx";
import * as api from "~/api/mercury";
import type { ChatThread } from "~/api/types";
import { useChat } from "~/app/store";
import { openThread, refreshThreads } from "~/app/events";

/** Threads, newest first, grouped by day. Quiet rows; the active one is marked, not coloured. */
export function ThreadList() {
  const threads = useChat((s) => s.threads);
  const activeId = useChat((s) => s.activeId);

  const groups = useMemo(() => groupByDay(threads), [threads]);

  async function remove(t: ChatThread) {
    try {
      await api.chat.deleteThread(t.id);
      if (activeId === t.id) void openThread(null);
      void refreshThreads();
    } catch { /* keep */ }
  }

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-soft">
      <div className="h-12 shrink-0" data-tauri-drag-region />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.length === 0 && <p className="px-2 pt-2 text-xs text-ink4">No threads yet.</p>}
        {groups.map(([day, list]) => (
          <div key={day} className="mb-3">
            <div className="px-2 pb-1 text-2xs font-medium uppercase tracking-wider text-ink4">{day}</div>
            {list.map((t) => (
              <div key={t.id} className={cx("group flex items-center rounded-md", activeId === t.id ? "bg-ink/[0.07]" : "hover:bg-ink/[0.05]")}>
                <button onClick={() => void openThread(t.id)} className="min-w-0 flex-1 truncate px-2.5 py-1.5 text-left text-sm text-ink2 group-hover:text-ink" title={t.title || "Untitled"}>
                  <span className={cx(activeId === t.id && "text-ink")}>{t.title || "Untitled"}</span>
                </button>
                <button onClick={() => void remove(t)} className="mr-1 hidden rounded p-1 text-ink4 hover:text-red group-hover:block" aria-label="Delete thread">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

function groupByDay(threads: ChatThread[]): Array<[string, ChatThread[]]> {
  const sorted = [...threads].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const out = new Map<string, ChatThread[]>();
  const today = new Date();
  for (const t of sorted) {
    const d = new Date(t.createdAt);
    const diff = Math.floor((startOfDay(today) - startOfDay(d)) / 86_400_000);
    const key = Number.isNaN(diff) ? "Earlier" : diff === 0 ? "Today" : diff === 1 ? "Yesterday" : diff < 7 ? "This week" : "Earlier";
    const list = out.get(key) ?? [];
    list.push(t);
    out.set(key, list);
  }
  return [...out.entries()];
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
