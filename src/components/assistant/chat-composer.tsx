"use client";

import { ArrowUpIcon, CrosshairSimpleIcon, CursorClickIcon, StopIcon, XIcon } from "@phosphor-icons/react";
import { AttachmentTray, ComposerTools, DropOverlay } from "@/components/ai/composer-tools";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type { AssistantChat } from "./use-assistant-chat";

/** Quick asks for a picked website section, by its kind. */
const SECTION_ASKS: Record<string, string[]> = {
  hero: ["Make the headline punchier", "Shorten the intro", "Change the button to Reserve now"],
  highlights: ["Rewrite these highlights", "Make them shorter", "Add one about parking"],
  steps: ["Simplify the steps", "Mention the deposit in the steps"],
  contact: ["Add our phone number", "Update our opening hours"],
  faq: ["Add a question about deposits", "Rename this section"],
  records: ["Rename this section", "Remove this section"],
  text: ["Make it shorter", "Make it friendlier"],
  form: ["Rename this section"],
  html: ["Remove this section"],
};

/** The website section attached to the next message, with a way to let go of it. */
function SectionChip({ chat }: { chat: AssistantChat }) {
  const { block } = chat;
  if (!block) return null;
  const asks = SECTION_ASKS[block.kind] ?? ["Rename this section"];
  return (
    <div key={`${block.viewId}:${block.blockId}`} className="enter-up flex w-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-primary/35 bg-primary/10 py-1 pr-1 pl-2 text-[12px] font-normal text-foreground">
          <CursorClickIcon className="size-3.5 shrink-0 text-primary" />
          <span className="truncate">
            <span className="font-medium">{block.label}</span>
            <span className="text-muted-foreground"> section</span>
          </span>
          <button
            type="button"
            aria-label="Stop editing this section"
            onClick={chat.clearBlock}
            className="ml-0.5 flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:bg-primary/15 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      </div>
      {!chat.input.trim() && !chat.pending ? (
        <div className="flex flex-wrap gap-1.5">
          {asks.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => chat.send(a)}
              className="cursor-pointer rounded-full border bg-background/40 px-2.5 py-0.5 text-[12px] font-normal text-muted-foreground outline-none transition-colors duration-150 hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {a}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Parts of the page picked for the next message (Pick from page), each with a way to let go of it. */
function PickedChips({ chat }: { chat: AssistantChat }) {
  if (!chat.picked.length) return null;
  return (
    <ul aria-label="Picked from the page" className="flex w-full flex-wrap gap-1.5">
      {chat.picked.map((p) => (
        <li
          key={p.id}
          title={p.path ? `${p.path} › ${p.label}` : p.label}
          className="enter-up inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border bg-background/40 py-0.5 pr-0.5 pl-2 text-[12px]"
        >
          <span className="shrink-0 text-muted-foreground">{p.kind}</span>
          <span className="truncate text-foreground">{p.label}</span>
          <button
            type="button"
            aria-label={`Remove ${p.label}`}
            onClick={() => chat.removePicked(p.id)}
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <XIcon className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Where you write to the assistant. Enter sends, Shift+Enter starts a new line, and the box grows with
 * the text. While a request is out, the send button becomes Stop.
 */
export function ChatComposer({
  chat,
  size,
  hint,
  autoFocus,
  className,
}: {
  chat: AssistantChat;
  size: "panel" | "page";
  hint?: React.ReactNode;
  autoFocus?: boolean;
  className?: string;
}) {
  const { files, voice, pending } = chat;
  const page = size === "page";
  const canSend = (!!chat.input.trim() || !!files.refs.length || !!chat.picked.length) && !files.uploading;

  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        chat.send();
      }}
      {...files.dropProps}
    >
      <InputGroup
        className={cn(
          // A disabled Send button shouldn't dim the whole box (the group fades when anything inside is disabled).
          "relative h-auto bg-card has-disabled:opacity-100 dark:bg-card dark:has-disabled:bg-card",
          page && "rounded-2xl shadow-[0_12px_40px_-20px_rgb(0_0_0/0.8)]",
        )}
      >
        <DropOverlay attachments={files} />
        {files.items.length || chat.block || chat.picked.length ? (
          <InputGroupAddon align="block-start" className="flex-col items-start gap-2 px-3 pt-3">
            <SectionChip chat={chat} />
            <PickedChips chat={chat} />
            {files.items.length ? <AttachmentTray attachments={files} /> : null}
          </InputGroupAddon>
        ) : null}
        <InputGroupTextarea
          ref={chat.textarea}
          autoFocus={autoFocus}
          aria-label="Message the assistant"
          placeholder={
            chat.block
              ? `Describe the change to the ${chat.block.label.toLowerCase()} section…`
              : chat.picked.length
                ? "What should change here, or what do you want to know?"
                : chat.manager
                  ? "Ask a question or describe a change…"
                  : "Ask a question…"
          }
          value={chat.input}
          rows={page ? 2 : 2}
          className={cn(
            "field-sizing-content resize-none",
            page
              ? "max-h-60 min-h-16 px-4 pt-3.5 text-[15px]"
              : "max-h-36 min-h-14 px-3 py-2.5 text-[13.5px]",
          )}
          onChange={(e) => chat.setInput(e.target.value)}
          onPaste={files.onPaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              chat.send();
            }
          }}
        />
        <InputGroupAddon
          align="block-end"
          className={cn("justify-between", page ? "px-3 pb-3" : "px-2 pb-2")}
        >
          <span className="flex items-center gap-2">
            <ComposerTools attachments={files} voice={voice} disabled={!!pending} />
            {page ? null : (
              <InputGroupButton
                size="icon-sm"
                aria-label="Pick from page"
                aria-pressed={chat.picking}
                title={chat.picking ? "Stop picking (Esc)" : "Pick something on the page to ask about"}
                disabled={!!pending}
                onClick={() => chat.setPicking(!chat.picking)}
                className={cn(
                  "hidden cursor-pointer md:inline-flex",
                  chat.picking && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary",
                )}
              >
                <CrosshairSimpleIcon />
              </InputGroupButton>
            )}
            {voice.state === "idle" && hint ? (
              <span className="hidden text-[11.5px] text-muted-foreground lg:inline">{hint}</span>
            ) : null}
          </span>
          {pending ? (
            <InputGroupButton
              key="stop"
              type="button"
              size="icon-sm"
              variant="secondary"
              aria-label="Stop"
              onClick={chat.stop}
              className="animate-swap cursor-pointer"
            >
              <StopIcon weight="fill" />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              key="send"
              type="submit"
              size="icon-sm"
              variant="default"
              aria-label="Send"
              disabled={!canSend}
              className="animate-swap cursor-pointer disabled:cursor-default"
            >
              <ArrowUpIcon weight="bold" />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

export function SendHint() {
  return (
    <>
      <Kbd>Shift</Kbd> <Kbd>↵</Kbd> for a new line
    </>
  );
}
