import { useState } from "react";
import type { HealthInfo } from "@/lib/api";
import type { Connection } from "./connections";

/**
 * Where am I connected? A small pill in the corner of the dashboard until
 * the cockpit HUD (design v2, board 02) absorbs it.
 */
export function ConnectionPill({ connection, health, onSwitch }: { connection: Connection; health: HealthInfo; onSwitch: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed bottom-3 right-3 z-50 flex flex-col items-end gap-1">
      {open && (
        <div className="w-64 rounded-lg border border-border bg-card p-3 text-xs shadow-lg">
          <div className="font-mono text-[11px] text-muted-foreground">{connection.baseUrl}</div>
          <div className="mt-1 flex items-center justify-between">
            <span>Mercury {health.version}</span>
            <span className="text-muted-foreground">API v{health.apiVersion}</span>
          </div>
          <div className="mt-1 text-muted-foreground">
            {connection.kind === "local" ? "On this computer · pid " + health.pid : "Remote · device token"}
          </div>
          <button className="mt-3 w-full rounded-md border border-border px-2 py-1.5 text-xs hover:bg-muted" onClick={onSwitch}>
            Switch connection…
          </button>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 items-center gap-2 rounded-full border border-border bg-background/90 px-3 text-xs backdrop-blur hover:bg-muted"
        title={connection.baseUrl}
      >
        <span className="block h-2 w-2 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" aria-hidden="true" />
        <span className="max-w-[160px] truncate">{connection.name}</span>
      </button>
    </div>
  );
}
