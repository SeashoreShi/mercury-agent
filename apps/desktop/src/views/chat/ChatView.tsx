import { PanelLeft } from "lucide-react";
import { useEffect } from "react";
import { useChat, useUi } from "~/app/store";
import { conversations, ConversationContext, useCodeSessions } from "~/app/conversation";
import { openThread } from "~/app/events";
import { Button } from "~/components/ui/Button";
import { Tooltip } from "~/components/ui/Tooltip";
import { Mark } from "~/components/Logo";
import { ThreadList } from "./ThreadList";
import { Conversation } from "./Conversation";

/**
 * Chat: sessions on the left (with New chat), one conversation. Its own
 * conversation store; Code sessions are not listed here.
 */
export function ChatView() {
  const sidebar = useUi((s) => s.sidebar);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const view = useUi((s) => s.view);
  const threads = useChat((s) => s.threads);
  const codeIds = useCodeSessions((s) => s.sessions);
  const activeId = conversations.chat((s) => s.activeId);

  const title = threads.find((t) => t.id === activeId)?.title || (activeId ? "Untitled" : "New chat");
  const codeSet = new Set(codeIds.map((c) => c.id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view !== "chat") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n" && !e.shiftKey) { e.preventDefault(); void openThread("chat", null); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") { e.preventDefault(); toggleSidebar(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar, view]);

  return (
    <ConversationContext.Provider value={conversations.chat}>
      <div className="flex h-full min-h-0">
        {sidebar && (
          <ThreadList
            threads={threads.filter((t) => !codeSet.has(t.id) && !(t.title ?? "").startsWith("Code · "))}
            activeId={activeId}
            onOpen={(id) => void openThread("chat", id)}
            onNew={() => void openThread("chat", null)}
            newLabel="New chat"
            searchLabel="Search chats"
          />
        )}
        <Conversation
          header={
            <>
              <Tooltip label={sidebar ? "Hide sessions" : "Show sessions"} shortcut="⌘B" side="bottom">
                <Button variant="ghost" size="sm" icon onClick={toggleSidebar} aria-label="Toggle sessions"><PanelLeft size={16} /></Button>
              </Tooltip>
              <span className="truncate text-base font-medium text-ink">{title}</span>
            </>
          }
          empty={
            <div className="flex flex-col items-center gap-4 px-6 pb-24 text-center">
              <div className="relative flex items-center justify-center">
                <span aria-hidden="true" className="absolute h-28 w-28 rounded-full animate-breathe" style={{ background: "radial-gradient(closest-side, rgb(var(--glow) / 0.22), rgb(var(--glow) / 0))" }} />
                <Mark size={64} className="relative" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-ink">Mercury Agent</h2>
              <p className="max-w-[460px] text-base text-ink3">This chat is empty. Ask, delegate, or think out loud. Mercury remembers what matters.</p>
            </div>
          }
          composer={{ surface: "chat", placeholder: "Ask anything…" }}
        />
      </div>
    </ConversationContext.Provider>
  );
}
