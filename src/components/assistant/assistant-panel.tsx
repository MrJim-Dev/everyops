"use client";

import {
  ArrowsOutSimpleIcon,
  ChatsCircleIcon,
  ClockCounterClockwiseIcon,
  SparkleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useAssistant } from "@/lib/assistant/panel-store";
import { cn } from "@/lib/utils";
import { ChatComposer } from "./chat-composer";
import { ChatThread } from "./chat-thread";
import { ThreadList } from "./reply-extras";
import { ThingsToFix } from "./things-to-fix";
import { useAssistantChat } from "./use-assistant-chat";

/**
 * The workspace assistant beside the page: ask anything about the workspace, or describe a change. Answers come from
 * the workspace's data, with links to what they're based on; changes come back as a plan that's applied only when
 * the person approves it, with undo, and recorded in History. Conversations are kept, and Ask EveryOps shows the
 * same one.
 */
export function AssistantPanel({ onClose, className }: { onClose: () => void; className?: string }) {
  // On phones the panel covers the page, so following a link closes it.
  const chat = useAssistantChat({
    onLeave: () => {
      if (window.matchMedia("(max-width: 767px)").matches) onClose();
    },
  });
  const { ws, manager, editor } = chat;
  const router = useRouter();
  const pathname = usePathname();
  /** The same conversation as a full page, with room to read plans; "Side panel" there comes back here. */
  const expand = () => {
    useAssistant.getState().setReturnTo(pathname);
    router.push(`${ws.basePath}/ask`);
  };

  return (
    <section aria-label="Ask EveryOps" className={cn("flex min-h-0 flex-col bg-background", className)}>
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <span className="mr-1 flex size-6 items-center justify-center rounded-md border">
          <LogoMark className="size-3" />
        </span>
        <span className="flex-1 text-[13.5px] font-semibold">Ask EveryOps</span>
        <Button
          size="icon-sm"
          variant={chat.showHistory ? "secondary" : "ghost"}
          aria-label="Conversations"
          aria-pressed={chat.showHistory}
          title="Conversations"
          onClick={() => chat.setShowHistory(!chat.showHistory)}
        >
          <ClockCounterClockwiseIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="New conversation"
          title="New conversation"
          disabled={!!chat.pending}
          onClick={chat.clear}
        >
          <ChatsCircleIcon />
        </Button>
        {manager ? (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Open as a full page"
            title="Open as a full page"
            className="hidden md:inline-flex"
            onClick={expand}
          >
            <ArrowsOutSimpleIcon />
          </Button>
        ) : null}
        <Button size="icon-sm" variant="ghost" aria-label="Close Ask EveryOps" onClick={onClose}>
          <XIcon />
        </Button>
      </header>

      {chat.showHistory ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <ThreadList
            threads={chat.threads}
            activeId={chat.activeId}
            onNew={chat.clear}
            onOpen={chat.openThread}
          />
        </div>
      ) : (
        <ChatThread
          chat={chat}
          size="panel"
          empty={
            <div className="flex flex-col gap-2 px-1 pt-2">
              <SparkleIcon className="size-5 text-primary" />
              <p className="text-[14px] font-medium">Ask anything about {ws.name}</p>
              <p className="text-[13px] text-muted-foreground">
                {manager
                  ? "Get answers from your data, or ask for any change: add, edit or delete records, pages, fields and cards, write pages, or manage the team. Every change is saved to History and can be undone."
                  : editor
                    ? "Get answers from your data, or ask to add, update or delete records. Every change is saved to History and can be undone."
                    : "Get answers from your data. Owners and admins can make changes."}
              </p>
              {editor ? (
                <ThingsToFix
                  workspaceId={ws.id}
                  workspaceName={ws.name}
                  onFix={(request) => chat.send(request)}
                />
              ) : null}
            </div>
          }
        />
      )}

      <ChatComposer
        chat={chat}
        size="panel"
        autoFocus
        className="border-t p-2.5"
        hint={
          <>
            <Kbd>⌘</Kbd> <Kbd>J</Kbd> to close
          </>
        }
      />
    </section>
  );
}

/** Opens the assistant: in the sidebar and as a floating button when the panel is closed. */
export function AssistantToggle({ children, className }: { children?: ReactNode; className?: string }) {
  const toggle = useAssistant((s) => s.toggle);
  return (
    <button type="button" onClick={() => toggle()} className={className}>
      {children}
    </button>
  );
}
