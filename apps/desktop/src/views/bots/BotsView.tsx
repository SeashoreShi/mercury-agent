import { ChevronDown, Play, RefreshCw, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cx } from "~/lib/cx";
import * as api from "~/api/mercury";
import type { BotManifest, BotRunRecord, BotStatus } from "~/api/types";
import type { AgentState } from "~/app/store";
import { useBots } from "~/app/store";
import { refreshBots } from "~/app/events";
import { Button } from "~/components/ui/Button";
import { Switch } from "~/components/ui/Switch";
import { Badge, Empty, Mono, SectionTitle } from "~/components/ui/bits";
import { StateOrb } from "~/components/indicators/StateOrb";
import { Input } from "~/components/ui/Input";
import { BotAvatar } from "~/components/BotAvatar";

/**
 * Bots, organised the way they work: each fleet is a lead with its crew
 * underneath; bots without a fleet are listed on their own. Selecting a
 * lead shows the whole fleet; selecting a crew member shows that bot.
 */

interface Fleet {
  lead: BotStatus;
  crew: BotStatus[];
}

function organise(bots: BotStatus[]): { fleets: Fleet[]; solo: BotStatus[] } {
  const byId = new Map(bots.map((b) => [b.id, b]));
  const crewOf = new Map<string, BotStatus[]>();
  for (const b of bots) {
    if (b.fleetRole === "crew" && b.parent && byId.has(b.parent)) {
      const list = crewOf.get(b.parent) ?? [];
      list.push(b);
      crewOf.set(b.parent, list);
    }
  }
  const fleets: Fleet[] = [];
  const solo: BotStatus[] = [];
  for (const b of bots) {
    if (b.fleetRole === "crew" && b.parent && byId.has(b.parent)) continue;
    if (b.fleetRole === "lead" || crewOf.has(b.id)) fleets.push({ lead: b, crew: (crewOf.get(b.id) ?? []).sort((x, y) => x.name.localeCompare(y.name)) });
    else solo.push(b);
  }
  fleets.sort((a, b) => a.lead.name.localeCompare(b.lead.name));
  solo.sort((a, b) => a.name.localeCompare(b.name));
  return { fleets, solo };
}

export function BotsView() {
  const bots = useBots((s) => s.bots);
  const available = useBots((s) => s.available);
  const activity = useBots((s) => s.activity);
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const { fleets, solo } = useMemo(() => organise(bots), [bots]);

  useEffect(() => {
    if (!selected && bots.length) setSelected(fleets[0]?.lead.id ?? solo[0]?.id ?? null);
  }, [bots, selected, fleets, solo]);

  if (!available) return <Empty title="Bots are not available on this runtime" body="Enable bots in the runtime's configuration to see them here." />;

  const selectedFleet = fleets.find((f) => f.lead.id === selected) ?? null;
  const selectedBot = bots.find((b) => b.id === selected) ?? null;

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-soft">
        <header className="flex h-[52px] shrink-0 items-center justify-between px-4" data-tauri-drag-region>
          <span className="text-base font-medium text-ink">Bots</span>
          <Button variant="ghost" size="sm" icon onClick={() => void refreshBots()} aria-label="Refresh"><RefreshCw size={14} /></Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {bots.length === 0 && <p className="px-2 text-sm text-ink4">No bots yet. Create one with `mercury bots create`.</p>}

          {fleets.map((f) => {
            const working = f.crew.filter((c) => c.state === "running").length + (f.lead.state === "running" ? 1 : 0);
            const isCollapsed = collapsed[f.lead.id] === true;
            return (
              <div key={f.lead.id} className="mb-3">
                <div className={cx("flex items-center rounded-lg", selected === f.lead.id ? "bg-ink/[0.07]" : "hover:bg-ink/[0.05]")}>
                  <button onClick={() => setSelected(f.lead.id)} className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left">
                    <BotAvatar id={f.lead.id} name={f.lead.name} hasAvatar={f.lead.hasAvatar} size={36} dimmed={!f.lead.enabled} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink">{f.lead.name}</span>
                        {f.lead.needsYou && <span className="block h-1.5 w-1.5 shrink-0 rounded-full bg-amber" aria-label="needs you" />}
                      </span>
                      <span className="block truncate text-xs text-ink3">Fleet · {f.crew.length} crew{working ? ` · ${working} working` : ""}</span>
                    </span>
                  </button>
                  <button onClick={() => setCollapsed((c) => ({ ...c, [f.lead.id]: !isCollapsed }))} className="mr-1.5 rounded p-1 text-ink4 hover:text-ink" aria-label={isCollapsed ? "Show crew" : "Hide crew"} aria-expanded={!isCollapsed}>
                    <ChevronDown size={15} className={cx("transition-transform", isCollapsed && "-rotate-90")} />
                  </button>
                </div>
                {!isCollapsed && (
                  <div className="ml-[27px] border-l border-line pl-2">
                    {f.crew.map((b) => (
                      <BotRow key={b.id} bot={b} activity={activity[b.id]} active={selected === b.id} onClick={() => setSelected(b.id)} size={26} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {solo.length > 0 && (
            <>
              <div className="px-2.5 pb-1 pt-2 text-2xs font-medium uppercase tracking-wider text-ink4">On their own</div>
              {solo.map((b) => <BotRow key={b.id} bot={b} activity={activity[b.id]} active={selected === b.id} onClick={() => setSelected(b.id)} size={32} />)}
            </>
          )}
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        {selectedFleet ? <FleetDetail fleet={selectedFleet} activity={activity} onSelect={setSelected} /> : selected ? <BotDetail id={selected} status={selectedBot} /> : <Empty title="Pick a bot" />}
      </section>
    </div>
  );
}

function BotRow({ bot, activity, active, onClick, size }: { bot: BotStatus; activity?: string; active: boolean; onClick: () => void; size: number }) {
  return (
    <button onClick={onClick} className={cx("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left", active ? "bg-ink/[0.07]" : "hover:bg-ink/[0.05]")}>
      <span className="relative">
        <BotAvatar id={bot.id} name={bot.name} hasAvatar={bot.hasAvatar} size={size} dimmed={!bot.enabled} />
        <StateOrb state={orbFor(bot)} size={8} className="absolute -bottom-0.5 -right-0.5 rounded-full bg-soft p-[1.5px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">{bot.name}</span>
        <span className={cx("block truncate text-xs", bot.state === "running" ? "text-accent" : "text-ink3")}>{activity ?? describe(bot)}</span>
      </span>
      {bot.needsYou && <span className="block h-1.5 w-1.5 shrink-0 rounded-full bg-amber" aria-label="needs you" />}
    </button>
  );
}

function orbFor(b: BotStatus): AgentState {
  if (b.needsYou) return "needs-you";
  if (!b.enabled || b.state === "disabled") return "offline";
  if (b.state === "running") return "working";
  if (b.state === "queued") return "thinking";
  return "idle";
}

function describe(b: BotStatus): string {
  if (!b.enabled) return "Off";
  if (b.state === "running") return "Working";
  if (b.state === "queued") return "Queued";
  if (b.state === "paused") return "Paused";
  if (b.lastRunAt) return `Last ran ${ago(b.lastRunAt)}`;
  return "Idle";
}

function FleetDetail({ fleet, activity, onSelect }: { fleet: Fleet; activity: Record<string, string>; onSelect: (id: string) => void }) {
  const { lead, crew } = fleet;
  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-7 px-8 py-7">
      <BotHeader id={lead.id} status={lead} subtitle={`Fleet lead · ${crew.length} crew`} />
      <div className="flex flex-col gap-3">
        <SectionTitle>Crew</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-3">
          {crew.map((b) => (
            <button key={b.id} onClick={() => onSelect(b.id)} className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3 text-left hover:border-line-strong">
              <span className="relative">
                <BotAvatar id={b.id} name={b.name} hasAvatar={b.hasAvatar} size={36} dimmed={!b.enabled} />
                <StateOrb state={orbFor(b)} size={9} className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface p-[1.5px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{b.name}</span>
                <span className={cx("block truncate text-xs", b.state === "running" ? "text-accent" : "text-ink3")}>{activity[b.id] ?? describe(b)}</span>
              </span>
            </button>
          ))}
          {crew.length === 0 && <p className="text-sm text-ink4">No crew yet.</p>}
        </div>
      </div>
      <BotBody id={lead.id} status={lead} />
    </div>
  );
}

function BotDetail({ id, status }: { id: string; status: BotStatus | null }) {
  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-7 px-8 py-7">
      <BotHeader id={id} status={status} />
      <BotBody id={id} status={status} />
    </div>
  );
}

function useBot(id: string, status: BotStatus | null) {
  const [bot, setBot] = useState<BotManifest | null>(null);
  const [journal, setJournal] = useState<BotRunRecord[]>([]);
  async function load() {
    try {
      const res = await api.bots.get(id);
      setBot(res.bot);
      setJournal(res.journal ?? []);
    } catch {
      setBot(null);
    }
  }
  useEffect(() => { void load(); }, [id, status?.state, status?.lastRunAt, status?.enabled]);
  return { bot, journal, reload: load };
}

function BotHeader({ id, status, subtitle }: { id: string; status: BotStatus | null; subtitle?: string }) {
  const { bot, reload } = useBot(id, status);
  async function toggle(enabled: boolean) {
    try { await (enabled ? api.bots.enable(id) : api.bots.disable(id)); } catch { /* keep */ }
    void refreshBots(); void reload();
  }
  if (!bot) return <div className="h-16" />;
  return (
    <header className="flex items-start gap-4">
      <BotAvatar id={id} name={bot.name} hasAvatar={status?.hasAvatar} size={56} dimmed={!bot.enabled} />
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-medium tracking-tight text-ink">{bot.name}</h1>
        <p className="mt-0.5 text-sm text-ink3">{subtitle ?? bot.description ?? (bot.fleetRole === "crew" ? `Crew of ${bot.parent}` : "")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Mono>{bot.id}</Mono>
          {bot.model?.model && <Badge>{bot.model.model}</Badge>}
          {bot.autonomy?.dailyTokenBudget && <Badge>{bot.autonomy.dailyTokenBudget.toLocaleString()} tokens/day</Badge>}
          {status?.needsYou && <Badge tone="amber">needs you</Badge>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch id={`bot-${id}`} checked={bot.enabled} onCheckedChange={(v) => void toggle(v)} label={bot.enabled ? "On" : "Off"} />
        {status?.state === "running" ? (
          <Button size="sm" variant="outline" onClick={() => void api.bots.stop(id).then(refreshBots)}><Square size={13} /> Stop</Button>
        ) : (
          <Button size="sm" variant="outline" disabled={!bot.enabled} onClick={() => void api.bots.run(id).then(refreshBots)}><Play size={13} /> Run now</Button>
        )}
      </div>
    </header>
  );
}

function BotBody({ id, status }: { id: string; status: BotStatus | null }) {
  const { bot, journal } = useBot(id, status);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { setNote(null); setMessage(""); }, [id]);
  async function send() {
    const text = message.trim();
    if (!text) return;
    try {
      const res = await api.bots.message(id, text);
      setNote(res.accepted ? "Queued." : `Not accepted${res.reasonCode ? ` (${res.reasonCode})` : ""}.`);
      setMessage("");
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  }
  if (!bot) return null;
  return (
    <>
      <div className="flex flex-col gap-2">
        <SectionTitle>Tell {bot.fleetRole === "lead" ? "the fleet" : "it"} something</SectionTitle>
        <div className="flex gap-2">
          <Input value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} placeholder={`Message ${bot.name}…`} className="h-10 text-base" />
          <Button variant="primary" size="lg" onClick={() => void send()} disabled={!message.trim()}>Send</Button>
        </div>
        {note && <p className="text-sm text-ink3">{note}</p>}
      </div>

      {bot.schedules && bot.schedules.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionTitle>Schedules</SectionTitle>
          {bot.schedules.map((s) => (
            <div key={s.name} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm">
              <span className="text-ink">{s.name}</span>
              <Mono>{s.cron}</Mono>
              <span className="min-w-0 flex-1 truncate text-sm text-ink3">{s.prompt}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SectionTitle>Recent runs</SectionTitle>
        {journal.length === 0 && <p className="text-sm text-ink4">Nothing yet.</p>}
        {journal.slice(0, 15).map((r) => (
          <div key={r.runId} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm">
            <StateOrb state={r.state === "failed" ? "needs-you" : r.state === "running" ? "working" : "idle"} size={9} />
            <span className="w-24 shrink-0 text-ink2">{ago(r.startedAt)}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{r.summary || r.error || r.state}</span>
            <Mono>{Math.round(r.durationMs / 1000)}s · {(r.tokensIn + r.tokensOut).toLocaleString()} tok</Mono>
          </div>
        ))}
      </div>
    </>
  );
}

function ago(ts: number): string {
  const ms = Date.now() - ts;
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
