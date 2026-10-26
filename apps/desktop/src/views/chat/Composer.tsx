import { ArrowUp, ChevronDown, Shield, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "~/lib/cx";
import * as api from "~/api/mercury";
import type { ChatSettings, ModelsResponse } from "~/api/types";
import { useRuntimeState } from "~/app/store";
import { sendMessage } from "~/app/events";
import { Button } from "~/components/ui/Button";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "~/components/ui/Menu";
import { Tooltip } from "~/components/ui/Tooltip";

/**
 * One box. Enter sends, Shift+Enter breaks a line. Below it: the model and
 * the approval mode (Ask Me / Allow All), both one click away and never a
 * settings page.
 */
export function Composer({ mode }: { mode: "chat" | "code" }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const agent = useRuntimeState((s) => s.agent);
  const connected = useRuntimeState((s) => s.connected);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  async function submit() {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendMessage(content);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  }

  const busy = agent === "thinking" || agent === "streaming" || agent === "working";

  return (
    <div className="shrink-0 px-8 pb-6 pt-2">
      <div className="mx-auto w-full max-w-[780px]">
        {error && <div className="mb-2 text-xs text-red">{error}</div>}
        <div className={cx("rounded-xl border border-line bg-surface shadow-sm transition-colors focus-within:border-line-strong")}>
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
            }}
            placeholder={mode === "code" ? "Describe the change…" : "Message Mercury…"}
            rows={1}
            disabled={!connected}
            className="block w-full resize-none bg-transparent px-4 pt-4 text-md leading-[26px] text-ink placeholder:text-ink4 disabled:opacity-60"
            aria-label="Message"
          />
          <div className="flex items-center gap-1 px-2 pb-2 pt-1">
            <ModelPicker />
            <ModePicker />
            <div className="flex-1" />
            {busy && <span className="mr-1 text-2xs text-ink4">{agent === "streaming" ? "answering" : agent === "working" ? "working" : "thinking"}…</span>}
            <Tooltip label="Send" shortcut="↵" side="top">
              <Button variant="primary" size="md" icon onClick={() => void submit()} disabled={!text.trim() || !connected} loading={sending} aria-label="Send">
                <ArrowUp size={16} strokeWidth={2.2} />
              </Button>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelPicker() {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const provider = useRuntimeState((s) => s.provider);
  const model = useRuntimeState((s) => s.model);

  async function load() {
    try { setModels(await api.chat.models()); } catch { setModels(null); }
  }
  useEffect(() => { void load(); }, [provider, model]);

  const label = models?.current?.label || model || provider || "Model";
  const groups = new Map<string, ModelsResponse["providers"]>();
  for (const p of models?.providers ?? []) {
    const list = groups.get(p.group) ?? [];
    list.push(p);
    groups.set(p.group, list);
  }

  return (
    <Menu
      side="top"
      trigger={
        <button className="flex h-8 items-center gap-1 rounded-md px-2 text-sm text-ink2 hover:bg-ink/[0.06] hover:text-ink" aria-label="Model">
          <span className="max-w-[180px] truncate">{label}</span>
          <ChevronDown size={12} className="text-ink4" />
        </button>
      }
    >
      {[...groups.entries()].map(([group, list], gi) => (
        <div key={group}>
          {gi > 0 && <MenuSeparator />}
          <MenuLabel>{group}</MenuLabel>
          {list.map((p) => (
            <MenuItem key={`${p.name}:${p.model}`} selected={p.isCurrent} disabled={!p.available} hint={p.available ? undefined : "no key"} onSelect={() => { void api.chat.switchModel(p.name, p.model).then(load); }}>
              {p.label}
            </MenuItem>
          ))}
        </div>
      ))}
      {groups.size === 0 && <MenuItem disabled>No providers configured</MenuItem>}
    </Menu>
  );
}

function ModePicker() {
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  useEffect(() => { void api.chat.settings().then(setSettings).catch(() => setSettings(null)); }, []);
  const allowAll = settings?.bypassPermissions === true;
  async function set(next: boolean) {
    try { setSettings(await api.chat.updateSettings({ bypassPermissions: next })); } catch { /* keep */ }
  }
  return (
    <Menu
      side="top"
      trigger={
        <button className={cx("flex h-8 items-center gap-1.5 rounded-md px-2 text-sm hover:bg-ink/[0.06]", allowAll ? "text-accent" : "text-amber")} aria-label="Approval mode">
          {allowAll ? <ShieldCheck size={13} /> : <Shield size={13} />}
          {settings ? (allowAll ? "Allow All" : "Ask Me") : "…"}
        </button>
      }
    >
      <MenuLabel>Before acting</MenuLabel>
      <MenuItem selected={!allowAll} onSelect={() => void set(false)}>Ask Me — approve each risky step</MenuItem>
      <MenuItem selected={allowAll} onSelect={() => void set(true)}>Allow All — only MCP and sends still ask</MenuItem>
    </Menu>
  );
}
