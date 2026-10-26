import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import * as api from "~/api/mercury";
import type { McpServer, PluginItem } from "~/api/types";
import { Button } from "~/components/ui/Button";
import { Switch } from "~/components/ui/Switch";
import { Badge, Empty, Mono, Segmented } from "~/components/ui/bits";
import { ConfirmButton, IconTile, ItemRow, PageHeader, SearchField } from "~/components/ui/kit";
import { StateOrb } from "~/components/indicators/StateOrb";
import { Input } from "~/components/ui/Input";

type Tab = "installed" | "catalog" | "mcp";

/**
 * Plugins: installed, the catalog, MCP servers. One row style across all
 * three; one primary action per row that names its state (Install,
 * Installing…, Update); on/off separate from Remove, and Remove asks twice.
 */
export function PluginsView() {
  const [tab, setTab] = useState<Tab>("installed");
  const [items, setItems] = useState<PluginItem[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [mcpAvailable, setMcpAvailable] = useState(true);
  const [safeMode, setSafeMode] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
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

  const q = query.trim().toLowerCase();
  const match = (s: string) => !q || s.toLowerCase().includes(q);
  const installed = useMemo(() => items.filter((p) => p.status !== "available" && match(`${p.name} ${p.description}`)), [items, q]);
  const catalog = useMemo(() => items.filter((p) => p.status === "available" && match(`${p.name} ${p.description}`)), [items, q]);
  const mcpShown = useMemo(() => servers.filter((s) => match(`${s.id} ${s.target}`)), [servers, q]);
  const updates = items.filter((p) => p.status === "update-available").length;

  async function act(key: string, fn: () => Promise<unknown>, done?: string) {
    setNote(null);
    setBusy(key);
    try { await fn(); if (done) setNote(done); } catch (err) { setNote(err instanceof Error ? err.message : String(err)); }
    setBusy(null);
    void load();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Plugins" meta={updates > 0 ? `${updates} update${updates === 1 ? "" : "s"} available` : undefined}>
        {safeMode && <Badge tone="amber">safe mode</Badge>}
        <Button variant="ghost" size="sm" icon onClick={() => void load(true)} loading={loading} aria-label="Refresh"><RefreshCw size={15} /></Button>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[820px] flex-col gap-3 px-8 py-6">
          <div className="flex items-center gap-3">
            <Segmented size="md" value={tab} onChange={setTab} options={[
              { value: "installed", label: `Installed · ${items.filter((p) => p.status !== "available").length}` },
              { value: "catalog", label: `Catalog · ${items.filter((p) => p.status === "available").length}` },
              { value: "mcp", label: `MCP · ${servers.length}` },
            ]} />
            <SearchField value={query} onChange={setQuery} placeholder="Search plugins" className="ml-auto w-[260px]" />
          </div>

          {note && <p className="text-sm text-ink3">{note}</p>}
          {catalogError && tab === "catalog" && <p className="text-sm text-amber">Catalog: {catalogError}</p>}

          {tab === "installed" && (installed.length === 0
            ? <Empty title={q ? "No installed plugin matches" : "No plugins installed"} body={q ? undefined : "Browse the catalog, or install from a path or URL below."} />
            : installed.map((p) => (
              <PluginRow key={p.id} p={p} actions={
                <>
                  {p.status === "update-available" && <Button size="sm" variant="primary" loading={busy === `u:${p.id}`} onClick={() => void act(`u:${p.id}`, () => api.plugins.update(p.id), `${p.name} updated.`)}>Update</Button>}
                  <Switch id={`plugin-${p.id}`} checked={p.enabled} onCheckedChange={(v) => void act(`t:${p.id}`, () => (v ? api.plugins.enable(p.id) : api.plugins.disable(p.id)))} label={p.enabled ? "On" : "Off"} />
                  <ConfirmButton size="sm" confirmLabel="Remove?" onConfirm={() => void act(`r:${p.id}`, () => api.plugins.uninstall(p.id), `${p.name} removed.`)}>Remove</ConfirmButton>
                </>
              } />
            )))}

          {tab === "catalog" && (catalog.length === 0
            ? <Empty title={q ? "No catalog plugin matches" : "Nothing new in the catalog"} />
            : catalog.map((p) => (
              <PluginRow key={p.id} p={p} actions={
                <Button size="sm" variant="outline" loading={busy === `i:${p.id}`} onClick={() => void act(`i:${p.id}`, () => api.plugins.install(p.id), `${p.name} installed.`)}>
                  {busy === `i:${p.id}` ? "Installing…" : "Install"}
                </Button>
              } />
            )))}

          {tab === "installed" && (
            <div className="mt-3 flex gap-2">
              <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Install from a path, URL or catalog id…" mono className="h-10" />
              <Button variant="outline" size="lg" disabled={!source.trim()} loading={busy === "src"} onClick={() => void act("src", () => api.plugins.install(source.trim()), "Installed.").then(() => setSource(""))}>Install</Button>
            </div>
          )}

          {tab === "mcp" && (!mcpAvailable
            ? <Empty title="MCP is not available on this runtime" body="Upgrade Mercury to 1.5 or newer." />
            : mcpShown.length === 0
              ? <Empty title={q ? "No server matches" : "No MCP servers"} body={q ? undefined : "Add one with `mercury mcp add` on the runtime's machine."} />
              : mcpShown.map((s) => <McpRow key={s.id} s={s} />))}
        </div>
      </div>
    </div>
  );
}

function PluginRow({ p, actions }: { p: PluginItem; actions: React.ReactNode }) {
  const problem = p.lastError || p.disabled?.message || p.incompatibleReason;
  const state = p.status === "error" || p.disabled ? "needs-you" : p.running ? "working" : p.enabled ? "idle" : "offline";
  return (
    <ItemRow
      tone={problem ? "warn" : undefined}
      tile={<span className="relative"><IconTile id={p.id} label={p.name} />{p.status !== "available" && <StateOrb state={state} size={9} className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface p-[1.5px]" />}</span>}
      title={p.name}
      badges={
        <>
          <Mono>{p.installedVersion ?? p.latestVersion ?? ""}</Mono>
          {p.tier === "official" && <Badge tone="accent">official</Badge>}
          {p.verified && p.tier !== "official" && <Badge>verified</Badge>}
          {p.status === "update-available" && <Badge tone="cyan">{p.latestVersion} available</Badge>}
          {p.status === "incompatible" && <Badge tone="amber">incompatible</Badge>}
          {p.channel?.state && <Badge>{p.channel.type} · {p.channel.state}</Badge>}
        </>
      }
      description={p.description}
      footer={
        <>
          {(p.tools.length > 0 || p.commands.length > 0) && (
            <p className="truncate font-mono text-xs text-ink4">
              {p.tools.length > 0 && `${p.tools.length} tool${p.tools.length === 1 ? "" : "s"}`}
              {p.tools.length > 0 && p.commands.length > 0 && " · "}
              {p.commands.map((c) => `/${c}`).join(" ")}
            </p>
          )}
          {problem && <p className="mt-1 text-sm text-amber">{problem}</p>}
        </>
      }
      actions={actions}
    />
  );
}

function McpRow({ s }: { s: McpServer }) {
  const state = s.state === "connected" ? "idle" : s.state === "failed" ? "needs-you" : s.state === "disabled" ? "offline" : "thinking";
  const allowed = s.tools.filter((t) => t.allowed !== false).length;
  return (
    <ItemRow
      tone={s.state === "failed" ? "warn" : undefined}
      tile={<span className="relative"><IconTile id={s.id} label={s.id} /><StateOrb state={state} size={9} className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface p-[1.5px]" /></span>}
      title={s.id}
      badges={<><Badge>{s.transport}</Badge><Badge tone={s.state === "connected" ? "accent" : s.state === "failed" ? "red" : "neutral"}>{s.state}</Badge></>}
      description={<Mono className="text-sm">{s.target}</Mono>}
      footer={<p className="text-sm text-ink3">{allowed} of {s.toolCount} tools allowed{s.error ? ` · ${s.error}` : ""}</p>}
    />
  );
}
