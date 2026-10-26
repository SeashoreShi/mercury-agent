import { RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { brain, type BrainPerson, type CheckStatus } from "~/api/brain";
import { Button } from "~/components/ui/Button";
import { Empty, Segmented, Spinner } from "~/components/ui/bits";
import { SearchField } from "~/components/ui/kit";
import { cx } from "~/lib/cx";
import { Initials, PersonCard, VerifiedBadge } from "./PersonCard";

type Filter = "people" | "pets" | "unreviewed" | "all";

/**
 * People: contact cards for everyone in the brain, search, filters, and the
 * card on the right. "Unreviewed" are names Mercury found but nobody has
 * confirmed; the checks panel shows the slow, capped model check.
 */
export function People({ initialId }: { initialId?: string | null }) {
  const [people, setPeople] = useState<BrainPerson[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("people");
  const [selected, setSelected] = useState<string | null>(initialId ?? null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setPeople((await brain.persons({ limit: 300 })).persons); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (initialId) setSelected(initialId); }, [initialId]);

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return (people ?? [])
      .filter((p) => filter === "all" || (filter === "pets" ? p.kind === "pet" : filter === "unreviewed" ? p.kind === "unverified" : p.kind === "person" || (p.kind === "unverified" && !!p.relationship && p.relationship !== "known")))
      .filter((p) => !query || p.name.toLowerCase().includes(query) || (p.relationship ?? "").toLowerCase().includes(query) || JSON.stringify(p.meta ?? {}).toLowerCase().includes(query));
  }, [people, q, filter]);

  const counts = useMemo(() => ({
    people: (people ?? []).filter((p) => p.kind === "person" || (p.kind === "unverified" && !!p.relationship && p.relationship !== "known")).length,
    pets: (people ?? []).filter((p) => p.kind === "pet").length,
    unreviewed: (people ?? []).filter((p) => p.kind === "unverified").length,
  }), [people]);

  if (error) return <Empty title="Couldn't load people" body={error} />;
  if (!people) return <div className="flex h-40 items-center justify-center text-ink3"><Spinner size={18} /></div>;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-3 px-6 pb-3 pt-4">
          <Segmented size="md" value={filter} onChange={setFilter} options={[
            { value: "people", label: `People · ${counts.people}` },
            { value: "pets", label: `Pets · ${counts.pets}` },
            { value: "unreviewed", label: `Unreviewed · ${counts.unreviewed}` },
            { value: "all", label: "All" },
          ]} />
          <SearchField value={q} onChange={setQ} placeholder="Search names, relationships, details" className="ml-auto w-[300px]" />
        </div>
        {filter === "unreviewed" && <ChecksPanel onChanged={load} />}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {shown.length === 0 ? <Empty title={q ? "No one matches" : filter === "unreviewed" ? "Nothing to review" : "No one here yet"} /> : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {shown.map((p) => (
                <button key={p.id} onClick={() => setSelected(p.id)}
                  className={cx("flex items-center gap-3 rounded-xl border bg-surface p-3 text-left transition-colors hover:border-line-strong", selected === p.id ? "border-accent/60" : "border-line")}>
                  <Initials name={p.name} kind={p.kind} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium text-ink">{p.name}</span>
                    <span className="block truncate text-xs capitalize text-ink3">{p.relationship && p.relationship !== "known" ? p.relationship : `${p.memoryCount} memor${p.memoryCount === 1 ? "y" : "ies"}`}</span>
                    <span className="mt-1 block"><VerifiedBadge p={p} /></span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {selected && (
        <aside className="w-[400px] shrink-0 overflow-y-auto border-l border-line bg-soft">
          <PersonCard id={selected} allPeople={people} onClose={() => setSelected(null)} onChanged={() => void load()} />
        </aside>
      )}
    </div>
  );
}

/** Dev-visible: what the "is it a person?" check is doing, with manual controls. */
function ChecksPanel({ onChanged }: { onChanged: () => void }) {
  const [s, setS] = useState<CheckStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => { try { setS(await brain.checks()); } catch { setS(null); } }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 15_000); return () => clearInterval(t); }, [load]);
  if (!s) return null;
  return (
    <div className="mx-6 mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
      <Sparkles size={15} className="text-cyan" />
      <span className="text-ink2">Model check: <span className="text-ink">{s.pending}</span> waiting · {s.callsToday}/{s.dailyCap} calls today · {s.checked} checked this run{s.lastRunAt ? ` · last ${new Date(s.lastRunAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</span>
      {s.lastError && <span className="text-xs text-amber">last error: {s.lastError}</span>}
      {note && <span className="text-xs text-ink3">{note}</span>}
      <span className="flex-1" />
      <Button size="sm" variant="outline" loading={busy === "queue"} onClick={() => { setBusy("queue"); void brain.queueExisting().then((r) => { setNote(`${r.queued} queued`); void load(); }).finally(() => setBusy(null)); }}>Check existing people</Button>
      <Button size="sm" variant="ghost" loading={busy === "run"} disabled={!s.enabled || s.pending === 0 || s.callsToday >= s.dailyCap} onClick={() => { setBusy("run"); void brain.runCheck().then((r) => { setNote(`${r.checked} checked`); void load(); onChanged(); }).catch((e) => setNote(String(e instanceof Error ? e.message : e))).finally(() => setBusy(null)); }}>
        <RefreshCw size={13} /> Run a batch now
      </Button>
    </div>
  );
}
