import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import * as api from "~/api/mercury";
import type { Skill } from "~/api/types";
import { Button } from "~/components/ui/Button";
import { Switch } from "~/components/ui/Switch";
import { Empty, Mono, Segmented } from "~/components/ui/bits";
import { ConfirmButton, IconTile, ItemRow, PageHeader, SearchField } from "~/components/ui/kit";
import { Input } from "~/components/ui/Input";

/** Skills the runtime has loaded: search, filter by on/off, toggle, remove (asks twice), install. */
export function SkillsView() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "on" | "off">("all");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try { setSkills((await api.skills.list()).skills); } catch (err) { setNote(err instanceof Error ? err.message : String(err)); }
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function act(key: string, fn: () => Promise<unknown>, done?: string) {
    setNote(null);
    setBusy(key);
    try { await fn(); if (done) setNote(done); } catch (err) { setNote(err instanceof Error ? err.message : String(err)); }
    setBusy(null);
    void load();
  }

  async function install() {
    const s = source.trim();
    if (!s) return;
    await act("install", () => (/^https?:\/\//i.test(s) ? api.skills.install(s) : api.skills.installFromRegistry(s)), "Installed.");
    setSource("");
  }

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => skills
    .filter((s) => filter === "all" || (filter === "on" ? s.active : !s.active))
    .filter((s) => !q || `${s.name} ${s.description ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)), [skills, filter, q]);
  const active = skills.filter((s) => s.active).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Skills" meta={`${active} of ${skills.length} on`}>
        <Button variant="ghost" size="sm" icon onClick={() => void load()} loading={loading} aria-label="Refresh"><RefreshCw size={15} /></Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[820px] flex-col gap-3 px-8 py-6">
          <div className="flex items-center gap-3">
            <Segmented size="md" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "on", label: "On" }, { value: "off", label: "Off" }]} />
            <SearchField value={query} onChange={setQuery} placeholder="Search skills" className="ml-auto w-[260px]" />
          </div>
          {note && <p className="text-sm text-ink3">{note}</p>}
          {shown.length === 0 && !loading && <Empty title={q || filter !== "all" ? "No skill matches" : "No skills loaded"} body={q || filter !== "all" ? undefined : "Install one by registry id or URL below, or let Mercury make its own."} />}
          {shown.map((s) => (
            <ItemRow
              key={s.name}
              tile={<IconTile id={s.name} label={s.name} />}
              title={s.name}
              description={s.description}
              footer={<Mono className="block truncate">{s.path}</Mono>}
              actions={
                <>
                  <Switch id={`skill-${s.name}`} checked={s.active} onCheckedChange={(v) => void act(`t:${s.name}`, () => (v ? api.skills.activate(s.name) : api.skills.deactivate(s.name)))} label={s.active ? "On" : "Off"} />
                  <ConfirmButton size="sm" confirmLabel="Remove?" onConfirm={() => void act(`r:${s.name}`, () => api.skills.remove(s.name), `${s.name} removed.`)}>Remove</ConfirmButton>
                </>
              }
            />
          ))}
          <div className="mt-3 flex gap-2">
            <Input value={source} onChange={(e) => setSource(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void install(); }} placeholder="Install by registry id or URL…" mono className="h-10" />
            <Button variant="outline" size="lg" disabled={!source.trim()} loading={busy === "install"} onClick={() => void install()}>Install</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
