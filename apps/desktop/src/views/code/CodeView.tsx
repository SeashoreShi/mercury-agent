import { useEffect, useState } from "react";
import * as api from "~/api/mercury";
import type { ChatSettings, CodeMode, CodeStatus } from "~/api/types";
import { Segmented, Mono } from "~/components/ui/bits";
import { Tooltip } from "~/components/ui/Tooltip";
import { ChatView } from "~/views/chat/ChatView";

/**
 * Code: the same conversation with the runtime's programming mode on,
 * driven by /api/code/status and /api/code/set.
 *   Off      plain chat
 *   Auto     Mercury decides when a request is a coding task
 *   Plan     it plans and waits for you before changing anything
 *   Execute  it plans and carries out the plan
 */
const MODES: Array<{ value: CodeMode; label: string; hint: string }> = [
  { value: "off", label: "Off", hint: "Plain chat" },
  { value: "auto", label: "Auto", hint: "Mercury decides when a request is a coding task" },
  { value: "plan", label: "Plan", hint: "Plans first and waits for you" },
  { value: "execute", label: "Execute", hint: "Plans and carries it out" },
];

export function CodeView() {
  const [status, setStatus] = useState<CodeStatus | null>(null);
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try { setStatus(await api.code.status()); } catch { setStatus(null); }
    try { setSettings(await api.chat.settings()); } catch { setSettings(null); }
  }
  useEffect(() => { void load(); }, []);

  async function setMode(state: CodeMode) {
    setError(null);
    try { await api.code.set(state); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    void load();
  }

  const current = MODES.find((m) => m.value === (status?.state ?? "off"));
  const header = (
    <div className="flex items-center gap-3">
      <Tooltip label={current?.hint ?? ""} side="bottom">
        <span>
          <Segmented<CodeMode> value={status?.state ?? "off"} onChange={(v) => void setMode(v)} options={MODES.map(({ value, label }) => ({ value, label }))} />
        </span>
      </Tooltip>
      {status?.statusText && <span className="truncate text-xs text-ink3">{status.statusText}</span>}
      {settings?.workspace && <Mono className="truncate">{settings.workspace}</Mono>}
      {status && !status.available && <span className="text-xs text-ink4">Not available on this runtime.</span>}
      {error && <span className="text-xs text-red">{error}</span>}
    </div>
  );

  return <ChatView mode="code" header={header} />;
}
