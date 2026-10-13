"use client";

import {
  CircleNotchIcon,
  FileAudioIcon,
  FilePdfIcon,
  FileTextIcon,
  FileVideoIcon,
  MicrophoneIcon,
  PaperclipIcon,
  StopIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useRef } from "react";
import { InputGroupButton } from "@/components/ui/input-group";
import { ATTACHMENT_ACCEPT, type AttachmentKind, type AttachmentRef } from "@/lib/assistant/attachments";
import { cn } from "@/lib/utils";
import type { Attachments } from "./use-attachments";
import type { VoiceInput } from "./use-voice-input";

const KIND_ICONS: Record<Exclude<AttachmentKind, "image">, typeof FileTextIcon> = {
  pdf: FilePdfIcon,
  audio: FileAudioIcon,
  video: FileVideoIcon,
  text: FileTextIcon,
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Attach and voice buttons for an AI prompt. While recording they turn into a timer with stop and cancel;
 * stopping fills the text box with what was said.
 */
export function ComposerTools({
  attachments,
  voice,
  disabled,
  onAttachClick,
  onVoiceClick,
}: {
  attachments?: Attachments;
  voice?: VoiceInput;
  disabled?: boolean;
  /** Replaces the default behaviour (e.g. send visitors to sign up first). */
  onAttachClick?: () => void;
  onVoiceClick?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  if (voice?.state === "recording")
    return (
      <output className="flex items-center gap-1" aria-live="polite">
        <span className="flex items-center gap-1.5 pr-1 text-[12px] tabular-nums text-muted-foreground">
          <span className="size-2 animate-pulse rounded-full bg-destructive" aria-hidden />
          Listening {clock(voice.seconds)}
        </span>
        <InputGroupButton size="icon-sm" aria-label="Cancel recording" onClick={voice.cancel}>
          <XIcon />
        </InputGroupButton>
        <InputGroupButton
          size="icon-sm"
          variant="secondary"
          aria-label="Stop and transcribe"
          onClick={voice.stop}
        >
          <StopIcon weight="fill" />
        </InputGroupButton>
      </output>
    );

  if (voice?.state === "transcribing")
    return (
      <output className="flex items-center gap-1.5 px-1 text-[12px] text-muted-foreground">
        <CircleNotchIcon className="size-3.5 animate-spin" aria-hidden />
        Writing down what you said…
      </output>
    );

  return (
    <span className="flex items-center gap-0.5">
      {attachments || onAttachClick ? (
        <>
          <input
            ref={input}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              if (e.target.files) attachments?.add(e.target.files);
              e.target.value = "";
            }}
          />
          <InputGroupButton
            size="icon-sm"
            aria-label="Attach files"
            title="Attach photos, PDFs or files"
            disabled={disabled}
            onClick={() => (onAttachClick ? onAttachClick() : input.current?.click())}
          >
            <PaperclipIcon />
          </InputGroupButton>
        </>
      ) : null}
      {onVoiceClick || voice?.supported ? (
        <InputGroupButton
          size="icon-sm"
          aria-label="Speak your message"
          title="Speak instead of typing"
          disabled={disabled}
          onClick={() => (onVoiceClick ? onVoiceClick() : void voice?.start())}
        >
          <MicrophoneIcon />
        </InputGroupButton>
      ) : null}
    </span>
  );
}

/** Files waiting to be sent with the message, with a remove button each. */
export function AttachmentTray({ attachments, className }: { attachments: Attachments; className?: string }) {
  if (!attachments.items.length) return null;
  return (
    <ul className={cn("flex w-full flex-wrap gap-1.5", className)} aria-label="Attached files">
      {attachments.items.map((f) => {
        const Icon = f.ref && f.ref.kind !== "image" ? KIND_ICONS[f.ref.kind] : FileTextIcon;
        return (
          <li
            key={f.key}
            className="flex h-8 max-w-[220px] animate-pop items-center gap-1.5 rounded-md border bg-background/60 pr-1 pl-1 text-[12px]"
          >
            {f.preview ? (
              // biome-ignore lint/performance/noImgElement: a local preview of the picked image
              <img src={f.preview} alt="" className="size-6 shrink-0 rounded-sm object-cover" />
            ) : (
              <Icon className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 truncate">{f.name}</span>
            {f.status === "uploading" ? (
              <CircleNotchIcon
                className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                aria-label="Uploading"
              />
            ) : null}
            <button
              type="button"
              aria-label={`Remove ${f.name}`}
              onClick={() => attachments.remove(f.key)}
              className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <XIcon className="size-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The files on a sent message: image thumbnails (the sender's own files) and named chips for the rest. */
export function MessageFiles({ files, className }: { files?: AttachmentRef[]; className?: string }) {
  if (!files?.length) return null;
  return (
    <ul className={cn("flex flex-wrap justify-end gap-1.5", className)}>
      {files.map((f) => {
        const src = `/api/ai/attachments/${f.id}`;
        if (f.kind === "image")
          return (
            <li key={f.id}>
              <a
                href={src}
                target="_blank"
                rel="noreferrer"
                title={f.name}
                className="block outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-lg"
              >
                {/* biome-ignore lint/performance/noImgElement: the sender's own upload, served privately */}
                <img
                  src={src}
                  alt={f.name}
                  className="h-20 w-auto max-w-40 rounded-lg border bg-muted object-cover"
                />
              </a>
            </li>
          );
        const Icon = KIND_ICONS[f.kind];
        return (
          <li
            key={f.id}
            className="flex h-8 max-w-[220px] items-center gap-1.5 rounded-md border bg-card px-2 text-[12px]"
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{f.name}</span>
          </li>
        );
      })}
    </ul>
  );
}
