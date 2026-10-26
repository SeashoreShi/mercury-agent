import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import * as api from "~/api/mercury";
import type { McpServer, PluginItem } from "~/api/types";
import { Button } from "~/components/ui/Button";
import { Switch } from "~/components/ui/Switch";
import { Badge, Empty, Mono, Segmented } from "~/components/ui/bits";
import { StateOrb } from "~/components/indicators/StateOrb";
import { Input } from "~/components/ui/Input";

type Tab = "installed" | "catalog" | "mcp";

/** Plugins, the catalog, and MCP servers: three lists, one row style. */
export function PluginsView() {
  const [tab, setTab] = useState<Tab>("installed");
  const [items, setItems] = useState<PluginItem[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [mcpAvailable, setMcpAvailable] = useState(true);
  const [safeMode, setSafeMode] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState("");
  const [note, setNote] = useState<string | null>(null);

  async function load(refresh = false) {
    setLoading(true);
    try {
      const res = await api.plugins.list(refresh);
      setItems(res.items);
      setSafeMode(res.safeMode);
      setCatalogError(res.catalogError ?? null);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
    try {
      const m = await api.mcp.list();
      setServers(m.servers);
      setMcpAvailable(m.available);
    } catch {
      setMcpAvailable(false);
    }
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const installed = useMemo(() => items.filter((p) => p.status !== "available"), [items]);
  const catalog = useMemo(() => items.filter((p) => p.status === "available"), [items]);

  async function act(fn: () => Promise<unknown>, done?: string) {
    setNote(null);
    try { await fn(); if (done) setNote(done); } catch (err) { setNote(err instanceof Error ? err.message : String(err)); }
    void load();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4" data-tauri-drag-region>
        <span className="text-sm font-medium text-ink">Plugins</span>
        <Segmented value={tab} onChange={setTab} options={[{ value: "installed", label: `Installed ${installed.length}` }, { value: "catalog", label: `Catalog ${catalog.length}` }, { value: "mcp", label: `MCP ${servers.length}` }]} />
        {safeMode && <Badge tone="amber">safe mode</Badge>}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" icon onClick={() => void load(true)} loading={loading} aria-label="Refresh"><RefreshCw size={14} /></Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[760px] flex-col gap-2 px-6 py-5">
          {note && <p className="text-xs text-ink3">{note}</p>}
          {catalogError && tab === "catalog" && <p className="text-xs text-amber">Catalog: {catalogError}</p>}

          {tab === "installed" && (installed.length === 0 ? <Empty title="No plugins installed" body="Pick one from the catalog, or install from a path or URL below." /> : installed.map((p) => (
            <PluginRow key={p.id} p={p} onToggle={(v) => void act(() => (v ? api.plugins.enable(p.id) : api.plugins.disable(p.id)))} onUpdate={() => void act(() => api.plugins.update(p.id), "Updated.")} onRemove={() => void act(() => api.plugins.uninstall(p.id), "Removed.")} />
          )))}

          {tab === "catalog" && (catalog.length === 0 ? <Empty title="Nothing new in the catalog" /> : catalog.map((p) => (
            <PluginRow key={p.id} p={p} onInstall={() => void act(() => api.plugins.install(p.id), "Installed.")} />
          )))}

          {tab === "installed" && (
            <div className="mt-4 flex gap-2">
              <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Install from a path, URL or catalog id…" mono />
              <Button variant="outline" disabled={!source.trim()} onClick={() => void act(() => api.plugins.install(source.trim()), "Installed.").then(() => setSource(""))}>Install</Button>
            </div>
          )}

          {tab === "mcp" && (!mcpAvailable ? <Empty title="MCP is not available on this runtime" body="Upgrade Mercury to 1.5 or newer." /> : servers.length === 0 ? <Empty title="No MCP servers" body="Add one with `mercury mcp add` on the runtime's machine." /> : servers.map((s) => <McpRow key={s.id} s={s} />))}
        </div>
      </div>
    </div>
  );
}

function PluginRow({ p, onToggle, onUpdate, onRemove, onInstall }: { p: PluginItem; onToggle?: (v: boolean) => void; onUpdate?: () => void; onRemove?: () => void; onInstall?: () => void }) {
  const state = p.status === "error" || p.disabled ? "needs-you" : p.running ? "working" : p.enabled ? "idle" : "offline";
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line bg-surface px-3.5 py-3">
      <StateOrb state={state} size={10} className="mt-[7px]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">{p.name}</span>
          <Mono>{p.installedVersion ?? p.latestVersion ?? ""}</Mono>
          {p.tier === "official" && <Badge tone="accent">official</Badge>}
          {p.verified && <Badge>verified</Badge>}
          {p.status === "update-available" && <Badge tone="cyan">update {p.latestVersion}</Badge>}
          {p.status === "incompatible" && <Badge tone="amber">incompatible</Badge>}
          {p.channel?.state && <Badge>{p.channel.type} · {p.channel.state}</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-ink3">{p.description}</p>
        {(p.tools.length > 0 || p.commands.length > 0) && (
          <p className="mt-1 truncate font-mono text-2xs text-ink4">
            {p.tools.length > 0 && `${p.tools.length} tool${p.tools.length === 1 ? "" : "s"}`}
            {p.tools.length > 0 && p.commands.length > 0 && " · "}
            {p.commands.map((c) => `/${c}`).join(" ")}
          </p>
        )}
        {(p.lastError || p.disabled?.message || p.incompatibleReason) && <p className="mt-1 text-xs text-amber">{p.lastError || p.disabled?.message || p.incompatibleReason}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {onInstall && <Button size="sm" variant="outline" onClick={onInstall}>Install</Button>}
        {onUpdate && p.status === "update-available" && <Button size="sm" variant="outline" onClick={onUpdate}>Update</Button>}
        {onToggle && <Switch checked={p.enabled} onCheckedChange={onToggle} label={p.enabled ? "On" : "Off"} id={`plugin-${p.id}`} />}
        {onRemove && <Button size="sm" variant="ghost" onClick={onRemove}>Remove</Button>}
      </div>
    </div>
  );
}

function McpRow({ s }: { s: McpServer }) {
  const state = s.state === "connected" ? "idle" : s.state === "failed" ? "needs-you" : s.state === "disabled" ? "offline" : "thinking";
  const allowed = s.tools.filter((t) => t.allowed !== false).length;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line bg-surface px-3.5 py-3">
      <StateOrb state={state} size={10} className="mt-[7px]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">{s.id}</span>
          <Badge>{s.transport}</Badge>
          <Badge tone={s.state === "connected" ? "accent" : s.state === "failed" ? "red" : "neutral"}>{s.state}</Badge>
        </div>
        <Mono className="mt-0.5 block truncate">{s.target}</Mono>
        <p className="mt-1 text-xs text-ink3">{allowed} of {s.toolCount} tools allowed{s.error ? ` · ${s.error}` : ""}</p>
      </div>
    </div>
  );
}
