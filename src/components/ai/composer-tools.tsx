"use client";

import {
  CircleNotchIcon,
  FileAudioIcon,
  FilePdfIcon,
  FileTextIcon,
  FileVideoIcon,
  ImageIcon,
  MicrophoneIcon,
  PaperclipIcon,
  StopIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
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

/** How long the mic can stay silent before we suggest checking it. */
const QUIET_MS = 3000;
const BARS = [0.55, 0.85, 1, 0.75, 0.5];

/**
 * A live level meter for the microphone. Bars are moved directly (no React render per frame). After a few
 * seconds without sound it reports `quiet`, so a muted or wrong microphone shows up while recording.
 */
function LevelMeter({
  analyser,
  onQuiet,
}: {
  analyser: AnalyserNode | null;
  onQuiet: (quiet: boolean) => void;
}) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const report = useRef(onQuiet);
  report.current = onQuiet;
  useEffect(() => {
    if (!analyser) return;
    const samples = new Float32Array(analyser.fftSize);
    const started = performance.now();
    let heard = started;
    let quiet = false;
    let frame = 0;
    const tick = (now: number) => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      // Speech sits around 0.05–0.3 RMS; scale so normal talking moves the meter without pinning it.
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 3);
      if (level > 0.06) heard = now;
      bars.current.forEach((bar, i) => {
        if (bar) bar.style.transform = `scaleY(${Math.max(0.18, level * BARS[i])})`;
      });
      const nowQuiet = now - heard > QUIET_MS;
      if (nowQuiet !== quiet) {
        quiet = nowQuiet;
        report.current(quiet);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      report.current(false);
    };
  }, [analyser]);
  return (
    <span className="flex h-4 items-center gap-[2px]" aria-hidden>
      {BARS.map((_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed set of bars
          key={i}
          ref={(el) => {
            bars.current[i] = el;
          }}
          style={{ transform: "scaleY(0.18)" }}
          className="h-full w-[3px] origin-center rounded-full bg-primary transition-transform duration-75"
        />
      ))}
    </span>
  );
}

/** While recording: the level meter, the time, and a hint when the mic hears nothing. */
function Recording({ voice }: { voice: VoiceInput }) {
  const [quiet, setQuiet] = useState(false);
  return (
    <output className="flex items-center gap-1" aria-live="polite">
      <span className="flex items-center gap-2 pr-1 text-[12px] tabular-nums text-muted-foreground">
        <LevelMeter analyser={voice.analyser} onQuiet={setQuiet} />
        {quiet ? (
          <span className="text-warning">Can't hear you. Check your mic.</span>
        ) : (
          <span>Listening {clock(voice.seconds)}</span>
        )}
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
}

/** Covers the composer while files are dragged over it, so it's clear they can be dropped there. */
export function DropOverlay({ attachments }: { attachments: Attachments }) {
  if (!attachments.dragging) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex animate-pop items-center justify-center gap-2 rounded-[inherit] border-2 border-dashed border-primary/70 bg-background/90 text-[13px] font-medium text-primary">
      <PaperclipIcon className="size-4" aria-hidden />
      Drop files to attach
    </div>
  );
}

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

  if (voice?.state === "recording") return <Recording voice={voice} />;

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
        // HEIC photos uploaded before photos were converted can't be shown by most browsers: list them by name.
        if (f.kind === "image" && f.mime !== "image/heic")
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
        const Icon = f.kind === "image" ? ImageIcon : KIND_ICONS[f.kind];
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
