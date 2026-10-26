import { useEffect } from "react";
import { useUi, type View } from "~/app/store";
import { useRuntimeEvents, refreshBots, refreshThreads } from "~/app/events";
import { usePulsePolling } from "~/app/pulse";
import { registerBuiltinStatusItems } from "~/extensions/builtin-status";
import type { Connection } from "~/shell/connections";
import type { HealthInfo } from "~/api/types";
import { Rail } from "./Rail";
import { EnvironmentBar } from "./EnvironmentBar";
import { StatusBar } from "./StatusBar";
import { ChatView } from "~/views/chat/ChatView";
import { CodeView } from "~/views/code/CodeView";
import { BotsView } from "~/views/bots/BotsView";
import { PluginsView } from "~/views/plugins/PluginsView";
import { SkillsView } from "~/views/skills/SkillsView";
import { SettingsView } from "~/views/settings/SettingsView";

registerBuiltinStatusItems();

/**
 * Everything after a connection is up:
 *   environment bar   which Mercury, where, who
 *   rail | view       all views mounted; the active one shown
 *   status bar        registered items, user-customisable
 */
export function Workspace({ connection, health, onSwitchConnection }: { connection: Connection; health: HealthInfo; onSwitchConnection: () => void }) {
  const view = useUi((s) => s.view);
  useRuntimeEvents(true);
  usePulsePolling(connection.id);

  useEffect(() => {
    void refreshThreads();
    void refreshBots();
  }, [connection.id]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg">
      <EnvironmentBar connection={connection} health={health} />
      <div className="flex min-h-0 flex-1">
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
      <StatusBar />
    </div>
  );
}

function Pane({ active, children }: { active: boolean; children: React.ReactNode }) {
  // A class, not the `hidden` attribute: Tailwind's preflight gives the
  // attribute zero specificity, so a `flex` class would win and show every
  // pane at once.
  return (
    <div className={active ? "absolute inset-0 flex flex-col" : "hidden"} aria-hidden={!active}>
      {children}
    </div>
  );
}

export type { View };
