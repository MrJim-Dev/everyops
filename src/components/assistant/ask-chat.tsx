"use client";

import { ChatsCircleIcon, ClockCounterClockwiseIcon, ListIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { ChatComposer, SendHint } from "./chat-composer";
import { ChatThread, Suggestions } from "./chat-thread";
import { ThreadList } from "./reply-extras";
import { useAssistantChat } from "./use-assistant-chat";

/**
 * Ask EveryOps as a full page: the same conversation as the side panel, with room to read plans.
 * Before the first message the composer sits in the middle of the page; after it, at the bottom.
 */
export function AskChat() {
  const chat = useAssistantChat();
  const { ws } = chat;
  const started = chat.turns.length > 0 || !!chat.pending;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-5">
        <h1 className="flex-1 text-[15px] font-semibold">Ask EveryOps</h1>
        <Button
          size="sm"
          variant="ghost"
          render={<Link href={`${ws.basePath}/history`} />}
          nativeButton={false}
        >
          <ClockCounterClockwiseIcon data-icon="inline-start" />
          History
        </Button>
        <Button
          size="sm"
          variant={chat.showHistory ? "secondary" : "ghost"}
          aria-pressed={chat.showHistory}
          onClick={() => chat.setShowHistory(!chat.showHistory)}
        >
          <ListIcon data-icon="inline-start" />
          Conversations
        </Button>
        {started ? (
          <Button size="sm" variant="outline" onClick={chat.clear} disabled={!!chat.pending}>
            <ChatsCircleIcon data-icon="inline-start" />
            New chat
          </Button>
        ) : null}
      </header>

      {chat.showHistory ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
          <div className="mx-auto w-full max-w-[640px]">
            <ThreadList
              threads={chat.threads}
              activeId={chat.activeId}
              onNew={chat.clear}
              onOpen={chat.openThread}
            />
          </div>
        </div>
      ) : started ? (
        <>
          <ChatThread chat={chat} size="page" />
          <div className="relative shrink-0 px-5 pb-5">
            {/* Messages fade out under the composer instead of meeting a hard line. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-background to-transparent"
            />
            <ChatComposer
              chat={chat}
              size="page"
              hint={<SendHint />}
              className="mx-auto w-full max-w-[720px]"
            />
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5">
          <div className="stagger-children flex w-full max-w-[680px] flex-col items-center pt-[14vh] pb-10">
            <span className="flex size-10 items-center justify-center rounded-xl border bg-card shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
              <LogoMark className="size-4.5" />
            </span>
            <h2 className="mt-5 text-center text-[26px] font-semibold tracking-[-0.02em] text-balance">
              What should we change in {ws.name}?
            </h2>
            <p className="mt-2 max-w-[460px] text-center text-[14px] text-muted-foreground text-pretty">
              Ask about your data or describe a change in your own words. You review every change before it's
              applied, and you can revert it from the chat or History.
            </p>
            <ChatComposer chat={chat} size="page" autoFocus hint={<SendHint />} className="mt-7 w-full" />
            <Suggestions
              items={chat.suggestions}
              onPick={(s) => chat.send(s)}
              className="mt-4 justify-center"
            />
          </div>
        </div>
      )}
    </div>
  );
}
