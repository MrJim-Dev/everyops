"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** Long enough for a detailed request; short enough to stay a quick message. */
const MAX_SECONDS = 120;
const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export type VoiceState = "idle" | "recording" | "transcribing";

/**
 * Voice input: records from the microphone, has Gemini transcribe it on the server, and hands the words to
 * `onText` so they land in the text box for the person to check before sending. The audio isn't stored.
 */
export function useVoiceInput(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [supported, setSupported] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const deliver = useRef(onText);
  deliver.current = onText;

  useEffect(() => {
    setSupported(typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
    return () => {
      cancelled.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const transcribe = useCallback(async (audio: Blob) => {
    setState("transcribing");
    try {
      const form = new FormData();
      form.set("audio", audio, audio.type.includes("mp4") ? "voice.m4a" : "voice.webm");
      const res = await fetch("/api/ai/transcribe", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; text: string }
        | { ok: false; message: string }
        | null;
      if (body?.ok && body.text) deliver.current(body.text);
      else if (body?.ok) toast("I didn't catch any words. Try again a little closer to the mic.");
      else toast("Couldn't turn that into text", { description: body?.message ?? "Try again." });
    } catch {
      toast("Couldn't turn that into text", { description: "Check your connection and try again." });
    } finally {
      setState("idle");
    }
  }, []);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      toast(denied ? "Allow microphone access to talk to EveryOps" : "No microphone found", {
        description: denied ? "Your browser asks for it in the address bar." : undefined,
      });
      return;
    }
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    cancelled.current = false;
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      recorder.current = null;
      if (cancelled.current || !chunks.length) {
        setState("idle");
        return;
      }
      void transcribe(new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" }));
    };
    recorder.current = rec;
    rec.start();
    setSeconds(0);
    setState("recording");
    const began = Date.now();
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - began) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) rec.stop();
    }, 250);
  }, [state, transcribe]);

  const cancel = useCallback(() => {
    cancelled.current = true;
    stop();
  }, [stop]);

  return { state, seconds, supported, start, stop, cancel };
}

export type VoiceInput = ReturnType<typeof useVoiceInput>;
