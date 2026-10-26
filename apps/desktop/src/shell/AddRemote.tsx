import { useState, type FormEvent } from "react";
import api, { PairError } from "@/lib/api";
import { normalizeBaseUrl } from "@/lib/connection";
import { cn } from "@/lib/utils";
import { desktop } from "./tauri";
import { newConnectionId, useConnections } from "./connections";

/**
 * Pair with a runtime that is not on this computer. Two ways in:
 *  - sign in with the dashboard username/password → the runtime mints a
 *    device token for this app (POST /api/auth/token);
 *  - paste a token made on that machine with `mercury devices add`.
 * Either way the password never persists here; only the token does, in
 * the OS keychain.
 */
export function AddRemote({ onAdded }: { onAdded: () => void }) {
  const [mode, setMode] = useState<"password" | "token">("password");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("mercury");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = useConnections((s) => s.add);
  const setActive = useConnections((s) => s.setActive);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const baseUrl = normalizeBaseUrl(url);
    if (!/^https?:\/\//i.test(baseUrl)) {
      setError("Enter the runtime's address, starting with http:// or https://");
      return;
    }
    setBusy(true);
    try {
      const platform = await desktop.platform();
      const host = await desktop.hostname();
      const deviceName = `${host} · Mercury Desktop`;
      let deviceId: string | undefined;
      let credential: string;
      if (mode === "password") {
        const paired = await api.auth.pair(baseUrl, username.trim(), password, deviceName, platform);
        credential = paired.token;
        deviceId = paired.device.id;
      } else {
        credential = token.trim();
        if (!/^mdt_[0-9a-f]{8}_[0-9a-f]{64}$/.test(credential)) throw new Error("That does not look like a device token (mdt_…).");
        const health = await api.health.probe(baseUrl, credential);
        if (!health.ok) throw new Error("The runtime answered, but not with a healthy status.");
        deviceId = credential.split("_")[1];
      }
      const id = newConnectionId();
      const label = name.trim() || new URL(baseUrl).host;
      await add({ id, kind: "remote", name: label, baseUrl, deviceId }, credential);
      await setActive(id);
      setPassword("");
      setToken("");
      onAdded();
    } catch (err) {
      if (err instanceof PairError) {
        setError(err.status === 429 && err.retryAfterSeconds ? `Too many attempts. Try again in ${Math.ceil(err.retryAfterSeconds / 60)} min.` : err.message);
      } else if (err instanceof TypeError) {
        setError("Could not reach that address. Check the URL, and that the runtime is reachable from here (tunnel, VPN, or a public host).");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-1 flex-col gap-2.5">
      <Label htmlFor="remote-url">Address</Label>
      <input id="remote-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mercury.tail1234.ts.net" autoCapitalize="off" autoCorrect="off" spellCheck={false} className={inputClass} />

      <div className="flex gap-1 rounded-md border border-border p-0.5 text-[11px]">
        <button type="button" onClick={() => setMode("password")} className={cn("flex-1 rounded px-2 py-1", mode === "password" ? "bg-muted text-foreground" : "text-muted-foreground")}>Sign in</button>
        <button type="button" onClick={() => setMode("token")} className={cn("flex-1 rounded px-2 py-1", mode === "token" ? "bg-muted text-foreground" : "text-muted-foreground")}>Device token</button>
      </div>

      {mode === "password" ? (
        <>
          <Label htmlFor="remote-user">Username</Label>
          <input id="remote-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" className={inputClass} />
          <Label htmlFor="remote-pass">Password</Label>
          <input id="remote-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={inputClass} />
        </>
      ) : (
        <>
          <Label htmlFor="remote-token">Device token</Label>
          <input id="remote-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="mercury devices add on that machine" autoComplete="off" className={inputClass} />
        </>
      )}

      <Label htmlFor="remote-name">Name (optional)</Label>
      <input id="remote-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Home server" className={inputClass} />

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11.5px] text-destructive">{error}</div>}

      <div className="flex-1" />
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="h-10 flex-1 rounded-lg border border-border bg-muted/40 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60">
          {busy ? "Connecting…" : "Connect"}
        </button>
        <button type="button" disabled className="h-10 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground opacity-60" title="QR pairing arrives with the phone app">Scan QR</button>
      </div>
    </form>
  );
}

const inputClass = "h-9 rounded-md border border-border bg-background px-3 font-mono text-[12.5px] text-foreground outline-none focus:border-primary";

function Label({ children, htmlFor }: { children: string; htmlFor: string }) {
  return <label htmlFor={htmlFor} className="font-mono text-[10px] tracking-wider text-muted-foreground">{children.toUpperCase()}</label>;
}
