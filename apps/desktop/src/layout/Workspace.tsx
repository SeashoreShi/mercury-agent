import { useEffect } from "react";
import { useUi, type View } from "~/app/store";
import { useRuntimeEvents, refreshBots, refreshThreads } from "~/app/events";
import type { Connection } from "~/shell/connections";
import type { HealthInfo } from "~/api/types";
import { Rail } from "./Rail";
import { ChatView } from "~/views/chat/ChatView";
import { CodeView } from "~/views/code/CodeView";
import { BotsView } from "~/views/bots/BotsView";
import { PluginsView } from "~/views/plugins/PluginsView";
import { SkillsView } from "~/views/skills/SkillsView";
import { SettingsView } from "~/views/settings/SettingsView";

/**
 * Everything after a connection is up. All views stay mounted; the active
 * one is shown. No lazy chunks, no transitions: the app is already here.
 */
export function Workspace({ connection, health, onSwitchConnection }: { connection: Connection; health: HealthInfo; onSwitchConnection: () => void }) {
  const view = useUi((s) => s.view);
  useRuntimeEvents(true);

  useEffect(() => {
    void refreshThreads();
    void refreshBots();
  }, [connection.id]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg">
      <Rail connectionName={connection.name} />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <Pane active={view === "chat"}><ChatView mode="chat" /></Pane>
        <Pane active={view === "code"}><CodeView /></Pane>
        <Pane active={view === "bots"}><BotsView /></Pane>
        <Pane active={view === "plugins"}><PluginsView /></Pane>
        <Pane active={view === "skills"}><SkillsView /></Pane>
        <Pane active={view === "settings"}><SettingsView connection={connection} health={health} onSwitchConnection={onSwitchConnection} /></Pane>
      </main>
    </div>
  );
}

function Pane({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col" hidden={!active} aria-hidden={!active}>
      {children}
    </div>
  );
}

export type { View };
