import { useEffect, useState } from "react";
import { TooltipProvider } from "~/components/ui/Tooltip";
import { useConnections, type Connection } from "~/shell/connections";
import { useRuntime } from "~/shell/useRuntime";
import { Onboarding } from "~/shell/Onboarding";
import { Workspace } from "~/layout/Workspace";
import { Wordmark } from "~/components/Logo";
import { Button } from "~/components/ui/Button";
import { desktop } from "~/shell/tauri";
import { configureApi } from "~/api/client";
import { useRuntimeState } from "./store";

/**
 * What fills the window:
 *  - no connection chosen → first run;
 *  - a connection → bring it up, then the workspace.
 */
export function App() {
  return (
    <TooltipProvider>
      <Root />
    </TooltipProvider>
  );
}

function Root() {
  const loaded = useConnections((s) => s.loaded);
  const connections = useConnections((s) => s.connections);
  const activeId = useConnections((s) => s.activeId);
  const load = useConnections((s) => s.load);
  const [switching, setSwitching] = useState(false);

  useEffect(() => { void load(); }, [load]);

  if (!loaded) return <Centered><Wordmark width={200} /></Centered>;

  const active = connections.find((c) => c.id === activeId) ?? null;
  if (!active || switching) return <Onboarding onDone={() => setSwitching(false)} canCancel={Boolean(active)} />;
  return <Connected key={active.id} connection={active} onSwitch={() => setSwitching(true)} />;
}

function Connected({ connection, onSwitch }: { connection: Connection; onSwitch: () => void }) {
  const setActive = useConnections((s) => s.setActive);
  const { status, retry } = useRuntime(connection, () => {});
  const setConnected = useRuntimeState((s) => s.setConnected);

  useEffect(() => { setConnected(status.phase === "ready"); }, [status.phase, setConnected]);

  if (status.phase === "ready") return <Workspace connection={connection} health={status.health} onSwitchConnection={onSwitch} />;

  return (
    <Centered>
      <div className="flex w-[420px] flex-col items-center gap-5 text-center">
        <Wordmark width={200} breathe={status.phase === "connecting"} />
        {status.phase === "connecting" && <p className="text-sm text-ink3">Connecting to <span className="text-ink">{connection.name}</span>…</p>}
        {status.phase === "offline" && (
          <>
            <p className="text-sm text-ink3"><span className="text-ink">{connection.name}</span> is not answering at <span className="font-mono text-xs">{connection.baseUrl}</span>.</p>
            <p className="text-xs text-ink4">{status.error}</p>
            {connection.kind === "local" && <StartLocal onStarted={retry} />}
            <div className="flex gap-2">
              <Button variant="primary" onClick={retry}>Try again</Button>
              <Button variant="outline" onClick={onSwitch}>Use another connection</Button>
            </div>
          </>
        )}
        {status.phase === "unauthorized" && (
          <>
            <p className="text-sm text-ink3">
              <span className="text-ink">{connection.name}</span> no longer accepts this device.
              {connection.kind === "remote" ? " The token was revoked or has changed." : " Mercury may have restarted with a new token."}
            </p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={retry}>Try again</Button>
              <Button variant="outline" onClick={onSwitch}>Pair again</Button>
            </div>
          </>
        )}
        {status.phase === "incompatible" && (
          <>
            <p className="text-sm text-ink3">
              {status.compat.reason === "desktop-too-old"
                ? `Mercury ${status.health.version} speaks a newer API (v${status.compat.apiVersion}) than this app. Update Mercury Desktop, or open the dashboard in your browser.`
                : `Mercury ${status.health.version || "(unknown)"} on ${connection.name} is older than this app supports. Run \`mercury upgrade\` there.`}
            </p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void desktop.openExternal(connection.baseUrl)}>Open in browser</Button>
              <Button variant="outline" onClick={onSwitch}>Use another connection</Button>
            </div>
          </>
        )}
        <button className="text-xs text-ink4 hover:text-ink2 hover:underline" onClick={() => { configureApi({ baseUrl: "", token: null }); void setActive(null); }}>
          Forget this connection
        </button>
      </div>
    </Centered>
  );
}

function StartLocal({ onStarted }: { onStarted: () => void }) {
  const [state, setState] = useState<"idle" | "starting" | "failed">("idle");
  const [detail, setDetail] = useState("");
  async function start() {
    setState("starting");
    try {
      const out = await desktop.runMercury(["start"]);
      if (out.code !== 0) { setState("failed"); setDetail((out.stderr || out.stdout).trim().slice(0, 400)); return; }
      setTimeout(onStarted, 2500);
    } catch (err) {
      setState("failed");
      setDetail(err instanceof Error ? err.message : String(err));
    }
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <Button variant="outline" loading={state === "starting"} onClick={() => void start()}>Start Mercury on this computer</Button>
      {state === "failed" && <pre className="max-w-[400px] whitespace-pre-wrap text-left font-mono text-2xs text-red">{detail}</pre>}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center bg-bg" data-tauri-drag-region>{children}</div>;
}
