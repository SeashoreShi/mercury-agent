import { useEffect, useState } from "react";
import * as api from "~/api/mercury";
import type { ChatSettings, CodeStatus } from "~/api/types";
import { Segmented, Mono } from "~/components/ui/bits";
import { ChatView } from "~/views/chat/ChatView";

/**
 * Code: the same conversation, with the runtime in plan or execute mode
 * against the workspace. The header carries the mode and the workspace;
 * nothing else changes, which is the point.
 */
export function CodeView() {
  const [status, setStatus] = useState<CodeStatus | null>(null);
  const [settings, setSettings] = useState<ChatSettings | null>(null);

  async function load() {
    try { setStatus(await api.code.status()); } catch { setStatus(null); }
    try { setSettings(await api.chat.settings()); } catch { setSettings(null); }
  }
  useEffect(() => { void load(); }, []);

  async function setMode(state: "off" | "plan" | "execute") {
    try { await api.code.set(state); } catch { /* keep */ }
    void load();
  }

  const header = (
    <div className="flex items-center gap-3">
      <Segmented
        value={status?.state ?? "off"}
        onChange={(v) => void setMode(v)}
        options={[{ value: "off", label: "Off" }, { value: "plan", label: "Plan" }, { value: "execute", label: "Execute" }]}
      />
      {settings?.workspace && <Mono className="truncate">{settings.workspace}</Mono>}
      {status && !status.available && <span className="text-xs text-ink4">Code mode is not available on this runtime.</span>}
    </div>
  );

  return <ChatView mode="code" header={header} />;
}
