import { useEffect, useState } from "react";
import api, { type HealthInfo } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Wordmark } from "./Wordmark";
import { AddRemote } from "./AddRemote";
import { InstallRuntime } from "./InstallRuntime";
import { desktop, type LocalRuntime } from "./tauri";
import { LOCAL_CONNECTION_ID, useConnections } from "./connections";
import { checkCompat, SUPPORTED_API } from "./compat";

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

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-background">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{
        backgroundImage: "linear-gradient(rgba(30,39,46,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(30,39,46,.35) 1px, transparent 1px)",
        backgroundSize: "48px 48px",
        maskImage: "radial-gradient(circle at 50% 30%, #000 0, transparent 70%)",
        WebkitMaskImage: "radial-gradient(circle at 50% 30%, #000 0, transparent 70%)",
      }} />

      <div className="relative mx-auto flex w-full max-w-[1120px] flex-1 flex-col items-center justify-center gap-8 px-6 py-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <Wordmark size={320} />
          <h1 className="sr-only">Mercury Agent</h1>
          <p className="max-w-[520px] text-sm leading-relaxed text-muted-foreground">
            Your agent, running where you choose. We checked {platformLabel} first; pick where Mercury should run.
            Change it later from the connection pill.
          </p>
        </div>

        {error && <div className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}

        <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-3">
          {/* 1 · Found here */}
          <Card highlighted={local.state === "running" || local.state === "outdated"} badge={local.state === "running" || local.state === "outdated" ? `FOUND ON ${platformLabel.toUpperCase()}` : undefined}>
            <CardTitle>Use the Mercury that's here</CardTitle>
            {local.state === "probing" && <CardBody>Looking for a running Mercury…</CardBody>}
            {local.state === "running" && (
              <>
                <CardBody>Mercury {local.health.version || local.runtime.binaryVersion || ""} is running{local.runtime.serviceInstalled ? " as a service" : ""}. The app attaches to it. Sessions, memory, skills and plugins stay exactly where they are.</CardBody>
                <Facts rows={[
                  ["bin", local.runtime.binaryPath ?? "—"],
                  ["daemon", `running · pid ${local.health.pid}`],
                  ["api", `127.0.0.1:${local.runtime.port} · v${local.health.apiVersion ?? "?"}`],
                  ["state", local.health.state],
                ]} />
                <div className="flex-1" />
                <PrimaryButton onClick={() => void useLocal()} disabled={busy !== null}>{busy === "local" ? "Connecting…" : "Connect"}</PrimaryButton>
              </>
            )}
            {local.state === "outdated" && (
              <>
                <CardBody>Mercury {local.health.version || local.runtime.binaryVersion || ""} is running here, but it predates the desktop API (needs API v{SUPPORTED_API.min}, Mercury 1.5 or newer). Upgrade it and the app attaches; nothing else changes.</CardBody>
                <Facts rows={[["bin", local.runtime.binaryPath ?? "—"], ["daemon", `running · pid ${local.health.pid}`], ["api", `127.0.0.1:${local.runtime.port} · v${local.health.apiVersion ?? "0"}`]]} />
                <div className="flex-1" />
                <PrimaryButton onClick={() => void upgradeLocal()} disabled={busy !== null}>{busy === "upgrade" ? "Upgrading…" : "Upgrade Mercury"}</PrimaryButton>
              </>
            )}
            {local.state === "installed" && (
              <>
                <CardBody>Mercury {local.runtime.binaryVersion ?? ""} is installed but not running. Start it and the app will attach.</CardBody>
                <Facts rows={[["bin", local.runtime.binaryPath ?? "—"], ["daemon", "stopped"], ["service", local.runtime.serviceInstalled ? "installed" : "not installed"]]} />
                <div className="flex-1" />
                <PrimaryButton onClick={() => void startLocal()} disabled={busy !== null}>{busy === "start" ? "Starting…" : "Start Mercury"}</PrimaryButton>
              </>
            )}
            {local.state === "missing" && (
              <>
                <CardBody>No Mercury on {platformLabel}. Install it with the card beside this one, or connect to one elsewhere.</CardBody>
                <div className="flex-1" />
                <SecondaryButton onClick={() => void probe()}>Check again</SecondaryButton>
              </>
            )}
          </Card>

          {/* 2 · Install here */}
          <Card>
            <CardTitle>Install Mercury here</CardTitle>
            <CardBody>For a fresh machine. The app downloads the matching release, verifies it, sets it up the way the installer does, and runs it as a service. No terminal.</CardBody>
            <InstallRuntime platform={platformLabel} onInstalled={onDone} />
          </Card>

          {/* 3 · Remote */}
          <Card>
            <CardTitle>Connect to a Mercury elsewhere</CardTitle>
            <CardBody>A server, a home machine, a phone running Termux, or Mercury Cloud. Add more connections later and use them side by side.</CardBody>
            <AddRemote onAdded={onDone} />
          </Card>
        </div>

        {connections.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
            <span>Saved:</span>
            {connections.map((c) => (
              <button key={c.id} className="rounded-full border border-border px-3 py-1 hover:bg-muted" onClick={() => { void setActive(c.id).then(onDone); }}>
                {c.name}
              </button>
            ))}
            {canCancel && <button className="ml-2 underline-offset-2 hover:underline" onClick={onDone}>Cancel</button>}
          </div>
        )}

        <Steps />
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
      "relative flex min-h-[300px] flex-col gap-3 rounded-xl bg-card p-5",
      highlighted ? "shadow-[inset_0_0_0_1px_hsl(var(--primary)),0_0_40px_rgba(52,225,161,.12)]" : "shadow-[inset_0_0_0_1px_hsl(var(--border))]"
    )}>
      {badge && (
        <span className="absolute -top-2.5 left-4 rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-primary-foreground">{badge}</span>
      )}
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-base font-semibold text-foreground">{children}</div>;
}

function CardBody({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return <div className={cn("text-[12.5px] leading-relaxed", muted ? "text-muted-foreground/80" : "text-muted-foreground")}>{children}</div>;
}

function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground" data-selectable>
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2"><span className="w-14 shrink-0 text-muted-foreground/60">{k}</span><span className="truncate text-foreground/80">{v}</span></div>
      ))}
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="h-10 rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-[0_0_18px_rgba(52,225,161,.35)] disabled:opacity-60">
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="h-10 rounded-lg border border-border bg-muted/40 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60">
      {children}
    </button>
  );
}

function Steps() {
  const steps = ["Where it runs", "Model and key", "Ask Me or Allow All", "Plugins"];
  return (
    <div className="flex items-center gap-4 font-mono text-[11px] text-muted-foreground">
      {steps.map((label, i) => (
        <span key={label} className="flex items-center gap-4">
          <span className="flex items-center gap-2">
            <span className={cn("flex h-[18px] w-[18px] items-center justify-center rounded-full", i === 0 ? "bg-primary font-bold text-primary-foreground" : "border border-border")}>{i + 1}</span>
            {label}
          </span>
          {i < steps.length - 1 && <span aria-hidden="true" className="block h-px w-10 bg-border" />}
        </span>
      ))}
    </div>
  );
}
