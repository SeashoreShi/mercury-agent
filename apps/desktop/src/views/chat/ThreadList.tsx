import { Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "~/lib/cx";
import * as api from "~/api/mercury";
import type { ChatThread } from "~/api/types";
import { useChat } from "~/app/store";
import { openThread, refreshThreads } from "~/app/events";

const PAGE = 40;

/**
 * Threads, most recently active first, grouped by day. Renders a page at a
 * time and adds the next page as the list scrolls; a filter box searches
 * all of them by title.
 */
export function ThreadList() {
  const threads = useChat((s) => s.threads);
  const activeId = useChat((s) => s.activeId);
  const [limit, setLimit] = useState(PAGE);
  const [query, setQuery] = useState("");
  const sentinel = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...threads].sort((a, b) => stamp(b).localeCompare(stamp(a)));
    return q ? sorted.filter((t) => (t.title || t.alias || "").toLowerCase().includes(q)) : sorted;
  }, [threads, query]);
  const page = filtered.slice(0, limit);
  const groups = useMemo(() => groupByDay(page), [page]);

  useEffect(() => { setLimit(PAGE); }, [query]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((l) => (l < filtered.length ? l + PAGE : l));
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length]);

  async function remove(t: ChatThread) {
    try {
      await api.chat.deleteThread(t.id);
      if (activeId === t.id) void openThread(null);
      void refreshThreads();
    } catch { /* keep */ }
  }

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-line bg-soft">
      <div className="flex h-[52px] shrink-0 items-center px-3" data-tauri-drag-region>
        <label className="flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-ink4 focus-within:border-line-strong">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search threads" className="w-full bg-transparent text-base text-ink placeholder:text-ink4" aria-label="Search threads" />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {filtered.length === 0 && <p className="px-3 pt-2 text-base text-ink4">{query ? "No matching threads." : "No threads yet."}</p>}
        {groups.map(([day, list]) => (
          <div key={day} className="mb-5">
            <div className="px-3 pb-1.5 text-xs font-medium uppercase tracking-wider text-ink4">{day}</div>
            {list.map((t) => (
              <div key={t.id} className={cx("group flex items-center rounded-lg", activeId === t.id ? "bg-ink/[0.07]" : "hover:bg-ink/[0.05]")}>
                <button onClick={() => void openThread(t.id)} className="min-w-0 flex-1 truncate px-3 py-2.5 text-left text-base" title={t.title || "Untitled"}>
                  <span className={activeId === t.id ? "text-ink" : "text-ink2 group-hover:text-ink"}>{t.title || "Untitled"}</span>
                </button>
                <button onClick={() => void remove(t)} className="mr-1 hidden rounded p-1 text-ink4 hover:text-red group-hover:block" aria-label="Delete thread">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        ))}
        <div ref={sentinel} className="h-px" aria-hidden="true" />
      </div>
    </aside>
  );
}

function stamp(t: ChatThread): string {
  return t.updatedAt || t.createdAt || "";
}

function groupByDay(threads: ChatThread[]): Array<[string, ChatThread[]]> {
  const out = new Map<string, ChatThread[]>();
  const today = startOfDay(new Date());
  for (const t of threads) {
    const diff = Math.floor((today - startOfDay(new Date(stamp(t)))) / 86_400_000);
    const key = Number.isNaN(diff) ? "Earlier" : diff <= 0 ? "Today" : diff === 1 ? "Yesterday" : diff < 7 ? "Previous 7 days" : diff < 30 ? "Previous 30 days" : "Older";
    const list = out.get(key) ?? [];
    list.push(t);
    out.set(key, list);
  }
  return [...out.entries()];
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
