import { useEffect, useState } from "react";
import { App } from "@/App";
import { configureApi } from "@/lib/connection";
import { useConnections, type Connection } from "./connections";
import { useRuntime } from "./useRuntime";
import { Onboarding } from "./Onboarding";
import { ConnectionPill } from "./ConnectionPill";
import { Wordmark } from "./Wordmark";
import { desktop } from "./tauri";

/**
 * The shell decides what fills the window:
 *  - nothing chosen yet → first-run (pick where Mercury runs);
 *  - a connection chosen → bring it up, then the dashboard itself.
 */
export function Shell() {
  const loaded = useConnections((s) => s.loaded);
  const connections = useConnections((s) => s.connections);
  const activeId = useConnections((s) => s.activeId);
  const load = useConnections((s) => s.load);
  const [switching, setSwitching] = useState(false);

  useEffect(() => { void load(); }, [load]);

  if (!loaded) return <Splash />;

  const active = connections.find((c) => c.id === activeId) ?? null;
  if (!active || switching) {
    return <Onboarding onDone={() => setSwitching(false)} canCancel={Boolean(active)} />;
  }
  return <Connected key={active.id} connection={active} onSwitch={() => setSwitching(true)} />;
}

function Connected({ connection, onSwitch }: { connection: Connection; onSwitch: () => void }) {
  const setActive = useConnections((s) => s.setActive);
  const { status, retry } = useRuntime(connection, () => { /* shown inline below */ });

  if (status.phase === "ready") {
    return (
      <>
        <App />
        <ConnectionPill connection={connection} health={status.health} onSwitch={onSwitch} />
      </>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="flex w-[420px] flex-col items-center gap-6 text-center">
        <Wordmark />
        {status.phase === "connecting" && (
          <p className="text-sm text-muted-foreground">Connecting to <span className="text-foreground">{connection.name}</span>…</p>
        )}
        {status.phase === "offline" && (
          <>
            <p className="text-sm text-muted-foreground">
              <span className="text-foreground">{connection.name}</span> is not answering at{" "}
              <span className="font-mono text-xs">{connection.baseUrl}</span>.
            </p>
            <p className="text-xs text-muted-foreground">{status.error}</p>
            {connection.kind === "local" && <StartLocalRuntime onStarted={retry} />}
            <div className="flex gap-2">
              <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" onClick={retry}>Try again</button>
              <button className="rounded-md border border-border px-4 py-2 text-sm" onClick={onSwitch}>Use another connection</button>
            </div>
          </>
        )}
        {status.phase === "unauthorized" && (
          <>
            <p className="text-sm text-muted-foreground">
              <span className="text-foreground">{connection.name}</span> no longer accepts this device.
              {connection.kind === "remote" ? " The token was revoked or has changed." : " Mercury may have restarted with a new token."}
            </p>
            <div className="flex gap-2">
              <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" onClick={retry}>Try again</button>
              <button className="rounded-md border border-border px-4 py-2 text-sm" onClick={onSwitch}>Pair again</button>
            </div>
          </>
        )}
        {status.phase === "incompatible" && (
          <>
            <p className="text-sm text-muted-foreground">
              {status.compat.reason === "desktop-too-old"
                ? `Mercury ${status.health.version} speaks a newer API (v${status.compat.apiVersion}) than this app. Update Mercury Desktop, or open the dashboard in your browser — it always matches the runtime.`
                : `Mercury ${status.health.version || "(unknown)"} on ${connection.name} is older than this app supports. Run \`mercury upgrade\` there.`}
            </p>
            <div className="flex gap-2">
              <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" onClick={() => void desktop.openExternal(connection.baseUrl)}>Open in browser</button>
              <button className="rounded-md border border-border px-4 py-2 text-sm" onClick={onSwitch}>Use another connection</button>
            </div>
          </>
        )}
        <button className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => { configureApi({ baseUrl: "", token: null }); void setActive(null); }}>
          Forget this connection
        </button>
      </div>
    </div>
  );
}

function StartLocalRuntime({ onStarted }: { onStarted: () => void }) {
  const [state, setState] = useState<"idle" | "starting" | "failed">("idle");
  const [detail, setDetail] = useState("");
  async function start() {
    setState("starting");
    try {
      const out = await desktop.runMercury(["start"]);
      if (out.code !== 0) {
        setState("failed");
        setDetail((out.stderr || out.stdout).trim().slice(0, 400));
        return;
      }
      // The listener binds within a second or two; health polling takes it from here.
      setTimeout(onStarted, 2500);
    } catch (err) {
      setState("failed");
      setDetail(err instanceof Error ? err.message : String(err));
    }
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <button className="rounded-md border border-primary/50 px-4 py-2 text-sm text-primary disabled:opacity-60" disabled={state === "starting"} onClick={() => void start()}>
        {state === "starting" ? "Starting Mercury…" : "Start Mercury on this computer"}
      </button>
      {state === "failed" && <pre className="max-w-[400px] whitespace-pre-wrap text-left font-mono text-[11px] text-destructive">{detail}</pre>}
    </div>
  );
}

function Splash() {
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <Wordmark />
    </div>
  );
}
