import { useCallback, useEffect, useRef, useState } from "react";
import api, { type HealthInfo } from "@/lib/api";
import { configureApi } from "@/lib/connection";
import { checkCompat, type Compat } from "./compat";
import { credentialFor, type Connection } from "./connections";

/**
 * Bring one connection to life: resolve its credential, point the shared
 * API client at it, prove the runtime answers, and keep checking.
 */

export type RuntimeStatus =
  | { phase: "connecting" }
  | { phase: "ready"; health: HealthInfo }
  | { phase: "offline"; error: string }
  | { phase: "unauthorized" }
  | { phase: "incompatible"; compat: Extract<Compat, { ok: false }>; health: HealthInfo };

const RECHECK_MS = 15_000;

export function useRuntime(connection: Connection, onUnauthorized: () => void): { status: RuntimeStatus; retry: () => void } {
  const [status, setStatus] = useState<RuntimeStatus>({ phase: "connecting" });
  const [attempt, setAttempt] = useState(0);
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function bringUp(): Promise<void> {
      setStatus({ phase: "connecting" });
      const token = await credentialFor(connection);
      if (cancelled) return;

      if (connection.kind === "remote" && !token) {
        setStatus({ phase: "unauthorized" });
        return;
      }

      configureApi({
        baseUrl: connection.baseUrl,
        token,
        onUnauthorized: () => {
          // A local runtime rotates its attach token at every boot; one
          // re-read fixes that case. Anything else is the shell's call.
          if (connection.kind === "local") {
            void credentialFor(connection).then((fresh) => {
              if (fresh && fresh !== token) {
                configureApi({ token: fresh });
                retry();
              } else {
                setStatus({ phase: "unauthorized" });
                unauthorizedRef.current();
              }
            });
            return;
          }
          setStatus({ phase: "unauthorized" });
          unauthorizedRef.current();
        },
        onSignedOut: () => unauthorizedRef.current(),
      });

      try {
        const health = await api.health.probe(connection.baseUrl, token);
        if (cancelled) return;
        const compat = checkCompat(health.apiVersion);
        if (!compat.ok) {
          setStatus({ phase: "incompatible", compat, health });
          return;
        }
        setStatus({ phase: "ready", health });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        if (message === "Unauthorized") {
          setStatus({ phase: "unauthorized" });
          return;
        }
        setStatus({ phase: "offline", error: message });
        timer = setTimeout(() => { if (!cancelled) void bringUp(); }, RECHECK_MS);
      }
    }

    void bringUp();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [connection, attempt, retry]);

  return { status, retry };
}
