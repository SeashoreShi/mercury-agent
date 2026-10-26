import { useEffect, useState } from "react";
import { cx } from "~/lib/cx";
import * as api from "~/api/mercury";
import type { DeviceSummary, HealthInfo } from "~/api/types";
import { TINTS, useTheme, type ThemeMode } from "~/app/theme";
import { useConnections, type Connection } from "~/shell/connections";
import { desktop, isTauri } from "~/shell/tauri";
import { Button } from "~/components/ui/Button";
import { Switch } from "~/components/ui/Switch";
import { Badge, Mono, SectionTitle, Segmented } from "~/components/ui/bits";
import { Dialog } from "~/components/ui/Dialog";
import { AddRemote } from "~/shell/AddRemote";
import { StateOrb } from "~/components/indicators/StateOrb";

/** Settings: appearance, connections, this runtime's devices, start-up, about. */
export function SettingsView({ connection, health, onSwitchConnection }: { connection: Connection; health: HealthInfo; onSwitchConnection: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[52px] shrink-0 items-center px-4" data-tauri-drag-region>
        <span className="text-sm font-medium text-ink">Settings</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[680px] flex-col gap-8 px-6 pb-10">
          <Appearance />
          <Connections current={connection} health={health} onSwitchConnection={onSwitchConnection} />
          <Devices current={connection} />
          <Startup />
          <About health={health} />
        </div>
      </div>
    </div>
  );
}

function Appearance() {
  const mode = useTheme((s) => s.mode);
  const tint = useTheme((s) => s.tint);
  const resolved = useTheme((s) => s.resolved);
  const setMode = useTheme((s) => s.setMode);
  const setTint = useTheme((s) => s.setTint);
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>Appearance</SectionTitle>
      <div className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3">
        <div>
          <div className="text-sm text-ink">Theme</div>
          <div className="text-xs text-ink3">Auto follows the system.</div>
        </div>
        <Segmented<ThemeMode> value={mode} onChange={setMode} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "Auto" }]} />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3">
        <div>
          <div className="text-sm text-ink">Tint</div>
          <div className="text-xs text-ink3">Only the accent changes. Amber and red stay what they mean.</div>
        </div>
        <div className="flex items-center gap-2">
          {TINTS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTint(t.id)}
              aria-label={t.label}
              aria-pressed={tint === t.id}
              title={t.label}
              className={cx("h-6 w-6 rounded-full border-2 transition-transform hover:scale-110", tint === t.id ? "border-ink" : "border-transparent")}
              style={{ background: resolved === "dark" ? t.dark : t.light }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function Connections({ current, health, onSwitchConnection }: { current: Connection; health: HealthInfo; onSwitchConnection: () => void }) {
  const connections = useConnections((s) => s.connections);
  const setActive = useConnections((s) => s.setActive);
  const remove = useConnections((s) => s.remove);
  const [adding, setAdding] = useState(false);
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle right={<Button size="sm" variant="outline" onClick={() => setAdding(true)}>Add connection</Button>}>Connections</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {connections.map((c) => (
          <div key={c.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
            <StateOrb state={c.id === current.id ? "idle" : "offline"} size={10} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm text-ink">
                {c.name}
                {c.id === current.id && <Badge tone="accent">connected</Badge>}
                <Badge>{c.kind === "local" ? "this computer" : "remote"}</Badge>
              </div>
              <Mono className="block truncate">{c.baseUrl}{c.id === current.id ? ` · Mercury ${health.version} · API v${health.apiVersion ?? "?"}` : ""}</Mono>
            </div>
            {c.id !== current.id && <Button size="sm" variant="outline" onClick={() => { void setActive(c.id); }}>Use</Button>}
            <Button size="sm" variant="ghost" onClick={() => { void remove(c.id).then(() => { if (c.id === current.id) onSwitchConnection(); }); }}>Forget</Button>
          </div>
        ))}
      </div>
      <Dialog open={adding} onOpenChange={setAdding} title="Connect to a Mercury elsewhere" description="A server, a home machine, a phone on Termux, or Mercury Cloud.">
        <AddRemote onAdded={() => setAdding(false)} />
      </Dialog>
    </section>
  );
}

function Devices({ current }: { current: Connection }) {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [self, setSelf] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  async function load() {
    try {
      const res = await api.auth.devices();
      setDevices(res.devices);
      setSelf(res.current);
    } catch {
      setSupported(false);
    }
  }
  useEffect(() => { void load(); }, [current.id]);
  if (!supported) return null;
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>Paired devices on {current.name}</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {devices.length === 0 && <p className="px-4 py-3 text-xs text-ink4">No devices paired. This app attaches with the local token.</p>}
        {devices.map((d) => (
          <div key={d.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm text-ink">{d.name}{d.id === self && <Badge tone="accent">this app</Badge>}</div>
              <Mono className="block">{d.platform} · {d.lastSeenAt ? `seen ${new Date(d.lastSeenAt).toLocaleString()}` : "never connected"}</Mono>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void api.auth.revokeDevice(d.id).then(load)}>Revoke</Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Startup() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    void import("@tauri-apps/plugin-autostart").then((m) => m.isEnabled()).then(setEnabled).catch(() => setEnabled(null));
  }, []);
  async function toggle(v: boolean) {
    const m = await import("@tauri-apps/plugin-autostart");
    try { await (v ? m.enable() : m.disable()); setEnabled(v); } catch { /* keep */ }
  }
  if (enabled === null) return null;
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>Start-up</SectionTitle>
      <div className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3">
        <div>
          <div className="text-sm text-ink">Open Mercury Desktop at login</div>
          <div className="text-xs text-ink3">The runtime's own start-up is separate: `mercury service install`.</div>
        </div>
        <Switch id="autostart" checked={enabled} onCheckedChange={(v) => void toggle(v)} />
      </div>
    </section>
  );
}

function About({ health }: { health: HealthInfo }) {
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    if (!isTauri) return;
    void import("@tauri-apps/api/app").then((m) => m.getVersion()).then(setAppVersion).catch(() => {});
  }, []);
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>About</SectionTitle>
      <div className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink2">
        <div className="flex items-center justify-between"><span>Mercury Desktop</span><Mono>{appVersion || "dev"}</Mono></div>
        <div className="mt-1 flex items-center justify-between"><span>Runtime</span><Mono>{health.version} · API v{health.apiVersion ?? "?"}</Mono></div>
        <button className="mt-3 text-xs text-accent hover:underline" onClick={() => void desktop.openExternal("https://mercuryagent.sh")}>mercuryagent.sh</button>
      </div>
    </section>
  );
}
