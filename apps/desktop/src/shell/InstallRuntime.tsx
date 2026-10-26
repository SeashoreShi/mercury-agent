import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { desktop, isTauri, type InstallProgress } from "./tauri";
import { LOCAL_CONNECTION_ID, useConnections } from "./connections";

/**
 * "Install Mercury here": download the matching runtime release, verify it,
 * put it in ~/.mercury/bin, write the minimum config, register the service
 * and start it — then attach, exactly like the "found here" path.
 */

type Step = "idle" | "download" | "setup" | "service" | "start" | "done" | "failed";

export function InstallRuntime({ platform, onInstalled }: { platform: string; onInstalled: () => void }) {
  const [owner, setOwner] = useState("");
  const [autostart, setAutostart] = useState(true);
  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(null);
  const unlisten = useRef<(() => void) | null>(null);
  const add = useConnections((s) => s.add);
  const setActive = useConnections((s) => s.setActive);

  useEffect(() => () => { unlisten.current?.(); }, []);

  async function run() {
    setError(null);
    setStep("download");
    try {
      unlisten.current = await desktop.onInstallProgress(setProgress);
      const installed = await desktop.installRuntime();
      unlisten.current?.();
      unlisten.current = null;

      setStep("setup");
      const setup = await desktop.runMercury(["setup", "--headless", "--owner", owner.trim() || "Owner", "--json"]);
      if (setup.code !== 0) throw new Error(firstLine(setup.stderr || setup.stdout) || "mercury setup failed");
      try {
        const parsed = JSON.parse(lastJsonLine(setup.stdout)) as { username?: string; password?: string | null; webPort?: number };
        if (parsed.username && parsed.password) setCredentials({ username: parsed.username, password: parsed.password });
      } catch { /* the wizard's JSON is a courtesy; attach does not need it */ }

      if (autostart) {
        setStep("service");
        const svc = await desktop.runMercury(["service", "install"]);
        if (svc.code !== 0) throw new Error(firstLine(svc.stderr || svc.stdout) || "mercury service install failed");
      }

      setStep("start");
      const runtime = await desktop.detectLocalRuntime();
      const baseUrl = `http://127.0.0.1:${runtime.port}`;
      if (!(await isUp(baseUrl))) {
        const start = await desktop.runMercury(["start"]);
        if (start.code !== 0) throw new Error(firstLine(start.stderr || start.stdout) || "mercury start failed");
      }
      const deadline = Date.now() + 30_000;
      while (!(await isUp(baseUrl))) {
        if (Date.now() > deadline) throw new Error("Mercury was installed but did not come up within 30 seconds. Check `mercury logs`.");
        await new Promise((r) => setTimeout(r, 1000));
      }

      const name = await desktop.hostname();
      await add({ id: LOCAL_CONNECTION_ID, kind: "local", name, baseUrl });
      await setActive(LOCAL_CONNECTION_ID);
      setStep("done");
      void installed;
      onInstalled();
    } catch (err) {
      unlisten.current?.();
      unlisten.current = null;
      setStep("failed");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const busy = step !== "idle" && step !== "failed" && step !== "done";

  return (
    <div className="flex flex-1 flex-col gap-2.5">
      <label htmlFor="install-owner" className="font-mono text-[10px] tracking-wider text-muted-foreground">YOUR NAME</label>
      <input id="install-owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="How Mercury should address you" disabled={busy}
        className="h-9 rounded-md border border-border bg-background px-3 text-[12.5px] text-foreground outline-none focus:border-primary" />
      <label className="flex items-center gap-2 text-[12.5px] text-foreground/90">
        <input type="checkbox" checked={autostart} onChange={(e) => setAutostart(e.target.checked)} disabled={busy} className="h-[15px] w-[15px] accent-[hsl(var(--primary))]" />
        Start Mercury when I log in
      </label>

      {busy && (
        <div className="rounded-md border border-border bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <div className="text-foreground/90">{stepLabel(step, progress)}</div>
          {step === "download" && progress?.percent != null && (
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${progress.percent}%` }} /></div>
          )}
        </div>
      )}
      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11.5px] text-destructive">{error}</div>}
      {credentials && (
        <div className="rounded-md border border-border bg-background px-3 py-2 font-mono text-[11px] text-muted-foreground" data-selectable>
          Browser login (shown once): <span className="text-foreground">{credentials.username}</span> / <span className="text-foreground">{credentials.password}</span>
        </div>
      )}

      <div className="flex-1" />
      <button onClick={() => void run()} disabled={busy || !isTauri} title={isTauri ? undefined : "Available inside the desktop app"}
        className="h-10 rounded-lg border border-border bg-muted/40 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60">
        {step === "failed" ? "Try again" : busy ? "Installing…" : `Install Mercury on ${platform}`}
      </button>
    </div>
  );
}

async function isUp(baseUrl: string): Promise<boolean> {
  try {
    const h = await api.health.probe(baseUrl, null, 1500);
    return h.ok;
  } catch {
    return false;
  }
}

function stepLabel(step: Step, progress: InstallProgress | null): string {
  switch (step) {
    case "download": return progress?.message ?? "Downloading Mercury…";
    case "setup": return "Writing the configuration…";
    case "service": return "Registering Mercury as a service…";
    case "start": return "Starting Mercury…";
    default: return "";
  }
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0] ?? "";
}

function lastJsonLine(text: string): string {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().startsWith("{"));
  return lines[lines.length - 1] ?? "{}";
}
