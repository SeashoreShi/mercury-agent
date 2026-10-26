import { Play, Square, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
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

/** Bots: the roster on the left with live state, one bot's detail on the right. */
export function BotsView() {
  const bots = useBots((s) => s.bots);
  const available = useBots((s) => s.available);
  const activity = useBots((s) => s.activity);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!selected && bots.length) setSelected(bots[0].id);
  }, [bots, selected]);

  if (!available) return <Empty title="Bots are not available on this runtime" body="Enable bots in the runtime's configuration to see them here." />;

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-line bg-soft">
        <header className="flex h-12 shrink-0 items-center justify-between px-4" data-tauri-drag-region>
          <span className="text-sm font-medium text-ink">Bots</span>
          <Button variant="ghost" size="sm" icon onClick={() => void refreshBots()} aria-label="Refresh"><RefreshCw size={14} /></Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {bots.length === 0 && <p className="px-2 text-xs text-ink4">No bots yet. Create one with `mercury bots create`.</p>}
          {bots.map((b) => (
            <button
              key={b.id}
              onClick={() => setSelected(b.id)}
              className={cx("flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left", selected === b.id ? "bg-ink/[0.07]" : "hover:bg-ink/[0.05]")}
            >
              <StateOrb state={orbFor(b)} size={10} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{b.name}</span>
                <span className="block truncate text-2xs text-ink3">{activity[b.id] ?? describe(b)}</span>
              </span>
              {b.needsYou && <Badge tone="amber">needs you</Badge>}
            </button>
          ))}
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        {selected ? <BotDetail id={selected} status={bots.find((b) => b.id === selected) ?? null} /> : <Empty title="Pick a bot" />}
      </section>
    </div>
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
  if (!b.enabled) return "disabled";
  if (b.state === "running") return "working";
  if (b.state === "queued") return "queued";
  if (b.lastRunAt) return `last run ${ago(b.lastRunAt)}${b.lastRunState ? ` · ${b.lastRunState}` : ""}`;
  return "idle";
}

function BotDetail({ id, status }: { id: string; status: BotStatus | null }) {
  const [bot, setBot] = useState<BotManifest | null>(null);
  const [journal, setJournal] = useState<BotRunRecord[]>([]);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.bots.get(id);
      setBot(res.bot);
      setJournal(res.journal ?? []);
    } catch {
      setBot(null);
    }
  }
  useEffect(() => { void load(); setNote(null); }, [id, status?.state, status?.lastRunAt]);

  async function toggle(enabled: boolean) {
    try { await (enabled ? api.bots.enable(id) : api.bots.disable(id)); } catch { /* keep */ }
    void refreshBots(); void load();
  }
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

  if (!bot) return <Empty title="Loading…" />;

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 py-5">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-medium tracking-tight text-ink">{bot.name}</h1>
          {bot.description && <p className="mt-0.5 text-sm text-ink3">{bot.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Mono>{bot.id}</Mono>
            {bot.fleetRole && <Badge>{bot.fleetRole}</Badge>}
            {bot.model?.model && <Badge>{bot.model.model}</Badge>}
            {bot.autonomy?.dailyTokenBudget && <Badge>{bot.autonomy.dailyTokenBudget.toLocaleString()} tokens/day</Badge>}
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

      <div className="flex flex-col gap-2">
        <SectionTitle>Tell it something</SectionTitle>
        <div className="flex gap-2">
          <Input value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} placeholder={`Message ${bot.name}…`} />
          <Button variant="primary" onClick={() => void send()} disabled={!message.trim()}>Send</Button>
        </div>
        {note && <p className="text-xs text-ink3">{note}</p>}
      </div>

      {bot.schedules && bot.schedules.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionTitle>Schedules</SectionTitle>
          {bot.schedules.map((s) => (
            <div key={s.name} className="flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 text-sm">
              <span className="text-ink">{s.name}</span>
              <Mono>{s.cron}</Mono>
              <span className="min-w-0 flex-1 truncate text-xs text-ink3">{s.prompt}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SectionTitle>Recent runs</SectionTitle>
        {journal.length === 0 && <p className="text-xs text-ink4">Nothing yet.</p>}
        {journal.slice(0, 20).map((r) => (
          <div key={r.runId} className="flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 text-xs">
            <StateOrb state={r.state === "failed" ? "needs-you" : r.state === "running" ? "working" : "idle"} size={9} />
            <span className="w-24 shrink-0 text-ink2">{ago(r.startedAt)}</span>
            <span className="w-16 shrink-0 text-ink3">{r.trigger}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{r.summary || r.error || r.state}</span>
            <Mono>{Math.round(r.durationMs / 1000)}s · {(r.tokensIn + r.tokensOut).toLocaleString()} tok</Mono>
          </div>
        ))}
      </div>
    </div>
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
