import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import * as api from "~/api/mercury";
import type { Skill } from "~/api/types";
import { Button } from "~/components/ui/Button";
import { Switch } from "~/components/ui/Switch";
import { Empty, Mono } from "~/components/ui/bits";
import { Input } from "~/components/ui/Input";

/** Skills the runtime has loaded; each one on or off, plus install by registry id or URL. */
export function SkillsView() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState("");
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try { setSkills((await api.skills.list()).skills); } catch (err) { setNote(err instanceof Error ? err.message : String(err)); }
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function act(fn: () => Promise<unknown>, done?: string) {
    setNote(null);
    try { await fn(); if (done) setNote(done); } catch (err) { setNote(err instanceof Error ? err.message : String(err)); }
    void load();
  }

  async function install() {
    const s = source.trim();
    if (!s) return;
    const isUrl = /^https?:\/\//i.test(s);
    await act(() => (isUrl ? api.skills.install(s) : api.skills.installFromRegistry(s)), "Installed.");
    setSource("");
  }

  const active = skills.filter((s) => s.active).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4" data-tauri-drag-region>
        <span className="text-sm font-medium text-ink">Skills</span>
        <span className="text-xs text-ink3">{active} of {skills.length} active</span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" icon onClick={() => void load()} loading={loading} aria-label="Refresh"><RefreshCw size={14} /></Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[760px] flex-col gap-2 px-6 py-5">
          {note && <p className="text-xs text-ink3">{note}</p>}
          {skills.length === 0 && !loading && <Empty title="No skills loaded" body="Install one by registry id or URL below, or let Mercury make its own." />}
          {skills.map((s) => (
            <div key={s.name} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{s.name}</div>
                {s.description && <p className="mt-0.5 text-xs text-ink3">{s.description}</p>}
                <Mono className="mt-0.5 block truncate">{s.path}</Mono>
              </div>
              <Switch id={`skill-${s.name}`} checked={s.active} onCheckedChange={(v) => void act(() => (v ? api.skills.activate(s.name) : api.skills.deactivate(s.name)))} label={s.active ? "On" : "Off"} />
              <Button size="sm" variant="ghost" onClick={() => void act(() => api.skills.remove(s.name), "Removed.")}>Remove</Button>
            </div>
          ))}
          <div className="mt-4 flex gap-2">
            <Input value={source} onChange={(e) => setSource(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void install(); }} placeholder="Registry id or URL…" mono />
            <Button variant="outline" disabled={!source.trim()} onClick={() => void install()}>Install</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
