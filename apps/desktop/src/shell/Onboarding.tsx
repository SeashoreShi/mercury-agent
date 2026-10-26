import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { type HealthInfo } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Wordmark } from "./Wordmark";
import { AddRemote } from "./AddRemote";
import { InstallRuntime } from "./InstallRuntime";
import { desktop, type LocalRuntime } from "./tauri";
import { LOCAL_CONNECTION_ID, useConnections } from "./connections";
import { checkCompat } from "./compat";

/**
 * First run (design v2, board 01): where should Mercury run?
 *   1. Use the Mercury found on this computer (attach, zero typing);
 *   2. Install Mercury here (next brick: the bundled runtime);
 *   3. Connect to a Mercury elsewhere (URL + password or device token).
 */

type LocalProbe =
  | { state: "probing" }
  | { state: "running"; runtime: LocalRuntime; health: HealthInfo }
  | { state: "outdated"; runtime: LocalRuntime; health: HealthInfo }
  | { state: "installed"; runtime: LocalRuntime }
  | { state: "missing"; runtime: LocalRuntime };

export function Onboarding({ onDone, canCancel }: { onDone: () => void; canCancel: boolean }) {
  const [local, setLocal] = useState<LocalProbe>({ state: "probing" });
  const [view, setView] = useState<"choose" | "install" | "remote">("choose");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const add = useConnections((s) => s.add);
  const setActive = useConnections((s) => s.setActive);
  const connections = useConnections((s) => s.connections);

  async function probe() {
    setLocal({ state: "probing" });
    const runtime = await desktop.detectLocalRuntime();
    try {
      const raw = await desktop.probeLocalHealth(runtime.port);
      const health = raw as unknown as HealthInfo;
      const compat = checkCompat(health.apiVersion);
      if (!compat.ok && compat.reason === "runtime-too-old") {
        setLocal({ state: "outdated", runtime, health });
      } else {
        setLocal({ state: "running", runtime, health });
      }
    } catch {
      setLocal(runtime.binaryPath ? { state: "installed", runtime } : { state: "missing", runtime });
    }
  }

  useEffect(() => { void probe(); }, []);

  async function useLocal() {
    if (local.state !== "running" && local.state !== "installed") return;
    setBusy("local");
    setError(null);
    try {
      const name = await desktop.hostname();
      await add({ id: LOCAL_CONNECTION_ID, kind: "local", name, baseUrl: `http://127.0.0.1:${local.runtime.port}` });
      await setActive(LOCAL_CONNECTION_ID);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function upgradeLocal() {
    setBusy("upgrade");
    setError(null);
    try {
      const out = await desktop.runMercury(["upgrade"]);
      if (out.code !== 0) throw new Error((out.stderr || out.stdout).trim().split(/\r?\n/)[0] || `mercury upgrade exited with ${out.code}`);
      // The upgrade restarts the daemon; give the listener a moment.
      await new Promise((r) => setTimeout(r, 4000));
      await probe();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function startLocal() {
    if (local.state !== "installed") return;
    setBusy("start");
    setError(null);
    try {
      const out = await desktop.runMercury(["start"]);
      if (out.code !== 0) throw new Error((out.stderr || out.stdout).trim() || `mercury start exited with ${out.code}`);
      await new Promise((r) => setTimeout(r, 2500));
      await probe();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const platformLabel = local.state === "probing" ? "this computer" : platformName(local.runtime.platform);

  const localVersion = local.state === "running" || local.state === "outdated"
    ? local.health.version || local.runtime.binaryVersion || ""
    : local.state === "installed" ? local.runtime.binaryVersion ?? "" : "";

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-background">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{
        backgroundImage: "linear-gradient(rgba(30,39,46,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(30,39,46,.35) 1px, transparent 1px)",
        backgroundSize: "48px 48px",
        maskImage: "radial-gradient(circle at 50% 30%, #000 0, transparent 70%)",
        WebkitMaskImage: "radial-gradient(circle at 50% 30%, #000 0, transparent 70%)",
      }} />

      <div className="relative mx-auto flex w-full max-w-[980px] flex-1 flex-col items-center justify-center gap-7 px-8">
        <div className="flex flex-col items-center gap-1 text-center">
          <Wordmark size={240} />
          <h1 className="sr-only">Mercury Agent</h1>
          <p className="max-w-[460px] text-[13px] leading-relaxed text-muted-foreground">
            {view === "choose" ? `Where should Mercury run? We checked ${platformLabel} first.` : view === "install" ? `Install Mercury on ${platformLabel}.` : "Connect to a Mercury elsewhere."}
          </p>
        </div>

        {error && <div className="w-full max-w-[640px] rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}

        {view === "choose" && (
          <div className="grid w-full grid-cols-3 gap-4">
            {/* 1 · Found here */}
            <Card highlighted={local.state === "running" || local.state === "outdated"} badge={local.state === "running" || local.state === "outdated" ? `FOUND ON ${platformLabel.toUpperCase()}` : undefined}>
              <CardTitle>Use the Mercury here</CardTitle>
              {local.state === "probing" && <CardBody>Looking for a running Mercury…</CardBody>}
              {local.state === "running" && <CardBody>Mercury {localVersion} is running{local.runtime.serviceInstalled ? " as a service" : ""}. The app attaches to it; nothing moves.</CardBody>}
              {local.state === "outdated" && <CardBody>Mercury {localVersion} is running, but it predates the desktop API (needs 1.5 or newer). Upgrade it and the app attaches.</CardBody>}
              {local.state === "installed" && <CardBody>Mercury {localVersion} is installed but not running.</CardBody>}
              {local.state === "missing" && <CardBody>No Mercury on {platformLabel} yet.</CardBody>}
              {(local.state === "running" || local.state === "outdated") && (
                <Mono>127.0.0.1:{local.runtime.port} · API v{local.health.apiVersion ?? 0} · pid {local.health.pid}</Mono>
              )}
              <div className="flex-1" />
              {local.state === "running" && <PrimaryButton onClick={() => void useLocal()} disabled={busy !== null}>{busy === "local" ? "Connecting…" : "Connect"}</PrimaryButton>}
              {local.state === "outdated" && <PrimaryButton onClick={() => void upgradeLocal()} disabled={busy !== null}>{busy === "upgrade" ? "Upgrading…" : "Upgrade Mercury"}</PrimaryButton>}
              {local.state === "installed" && <PrimaryButton onClick={() => void startLocal()} disabled={busy !== null}>{busy === "start" ? "Starting…" : "Start Mercury"}</PrimaryButton>}
              {(local.state === "missing" || local.state === "probing") && <SecondaryButton onClick={() => void probe()} disabled={local.state === "probing"}>Check again</SecondaryButton>}
            </Card>

            {/* 2 · Install here */}
            <Card>
              <CardTitle>Install Mercury here</CardTitle>
              <CardBody>Downloads the matching release, verifies it and runs it as a service. No terminal.</CardBody>
              <div className="flex-1" />
              <SecondaryButton onClick={() => setView("install")}>Install here…</SecondaryButton>
            </Card>

            {/* 3 · Remote */}
            <Card>
              <CardTitle>Connect elsewhere</CardTitle>
              <CardBody>A server, a home machine, a phone on Termux, or Mercury Cloud. Several at once if you like.</CardBody>
              <div className="flex-1" />
              <SecondaryButton onClick={() => setView("remote")}>Add a connection…</SecondaryButton>
            </Card>
          </div>
        )}

        {view === "install" && (
          <Panel onBack={() => setView("choose")}>
            <InstallRuntime platform={platformLabel} onInstalled={onDone} />
          </Panel>
        )}

        {view === "remote" && (
          <Panel onBack={() => setView("choose")}>
            <AddRemote onAdded={onDone} />
          </Panel>
        )}

        {(connections.length > 0 || canCancel) && view === "choose" && (
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
            {connections.length > 0 && <span>Saved:</span>}
            {connections.map((c) => (
              <button key={c.id} className="rounded-full border border-border px-3 py-1 hover:bg-muted" onClick={() => { void setActive(c.id).then(onDone); }}>
                {c.name}
              </button>
            ))}
            {canCancel && <button className="ml-2 underline-offset-2 hover:underline" onClick={onDone}>Cancel</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function platformName(p: LocalRuntime["platform"]): string {
  switch (p) {
    case "macos": return "this Mac";
    case "windows": return "this PC";
    case "linux": return "this machine";
    default: return "this computer";
  }
}

function Card({ children, highlighted, badge }: { children: React.ReactNode; highlighted?: boolean; badge?: string }) {
  return (
    <div className={cn(
      "relative flex h-[188px] flex-col gap-2 rounded-xl bg-card p-5",
      highlighted ? "shadow-[inset_0_0_0_1px_hsl(var(--primary)),0_0_40px_rgba(52,225,161,.12)]" : "shadow-[inset_0_0_0_1px_hsl(var(--border))]"
    )}>
      {badge && (
        <span className="absolute -top-2.5 left-4 rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-primary-foreground">{badge}</span>
      )}
      {children}
    </div>
  );
}

function Panel({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="relative flex w-full max-w-[440px] flex-col gap-3 rounded-xl bg-card p-5 shadow-[inset_0_0_0_1px_hsl(var(--border))]">
      <button onClick={onBack} className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} aria-hidden="true" /> Back
      </button>
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-[15px] font-semibold text-foreground">{children}</div>;
}

function CardBody({ children }: { children: React.ReactNode }) {
  return <div className="text-[12.5px] leading-relaxed text-muted-foreground">{children}</div>;
}

function Mono({ children }: { children: React.ReactNode }) {
  return <div className="truncate font-mono text-[11px] text-muted-foreground/80" data-selectable>{children}</div>;
}

function PrimaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="h-9 rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground shadow-[0_0_18px_rgba(52,225,161,.35)] disabled:opacity-60">
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="h-9 rounded-lg border border-border bg-muted/40 text-[13px] font-semibold text-foreground hover:bg-muted disabled:opacity-60">
      {children}
    </button>
  );
}
