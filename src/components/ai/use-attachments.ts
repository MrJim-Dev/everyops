"use client";

import { type ClipboardEvent, type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type AttachmentRef, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "@/lib/assistant/attachments";
import { isHeic, MAX_SOURCE_BYTES, prepareImage } from "@/lib/prepare-image";

export type PendingFile = {
  key: string;
  name: string;
  /** A local preview for images while (and after) they upload. */
  preview?: string;
  status: "uploading" | "ready";
  ref?: AttachmentRef;
};

async function upload(
  file: File,
): Promise<{ ok: true; ref: AttachmentRef } | { ok: false; message: string }> {
  try {
    const form = new FormData();
    form.set("file", file);
    const res = await fetch("/api/ai/attachments", { method: "POST", body: form });
    const body = (await res.json().catch(() => null)) as
      | { ok: true; attachment: AttachmentRef }
      | { ok: false; message: string }
      | null;
    if (body?.ok) return { ok: true, ref: body.attachment };
    return { ok: false, message: body?.message ?? "Try again." };
  } catch {
    return { ok: false, message: "Check your connection and try again." };
  }
}

let counter = 0;

/**
 * Files attached to the message being written. Each one uploads as soon as it's picked, pasted or dropped, so
 * sending only waits for uploads still in flight. The message then carries the uploaded references.
 */
export function useAttachments() {
  const [items, setItems] = useState<PendingFile[]>([]);
  const count = useRef(0);
  count.current = items.length;
  const previews = useRef(new Set<string>());

  useEffect(() => {
    const urls = previews.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  const add = useCallback((list: Iterable<File>) => {
    const files = [...list];
    if (!files.length) return;
    const room = MAX_ATTACHMENTS - count.current;
    if (files.length > room) toast(`You can attach up to ${MAX_ATTACHMENTS} files to one message.`);
    for (const file of files.slice(0, Math.max(room, 0))) {
      // Photos are shrunk before upload, so a large one is fine; other files must already fit.
      const photo = file.type.startsWith("image/") || isHeic(file);
      if (file.size > (photo ? MAX_SOURCE_BYTES : MAX_ATTACHMENT_BYTES)) {
        toast(`"${file.name}" is over ${photo ? 40 : 10} MB.`);
        continue;
      }
      const key = `f${++counter}`;
      count.current++;
      setItems((s) => [...s, { key, name: file.name || "Pasted image", status: "uploading" }]);
      void (async () => {
        const ready = photo ? await prepareImage(file) : file;
        if (ready.size > MAX_ATTACHMENT_BYTES) {
          setItems((s) => s.filter((f) => f.key !== key));
          toast(`"${file.name}" is over 10 MB.`);
          return;
        }
        // Preview the prepared copy: browsers that can't show HEIC can show the JPEG made from it.
        const preview =
          ready.type.startsWith("image/") && ready.type !== "image/heic"
            ? URL.createObjectURL(ready)
            : undefined;
        if (preview) {
          previews.current.add(preview);
          setItems((s) => s.map((f) => (f.key === key ? { ...f, preview, name: ready.name || f.name } : f)));
        }
        const result = await upload(ready);
        if (result.ok)
          setItems((s) => s.map((f) => (f.key === key ? { ...f, status: "ready", ref: result.ref } : f)));
        else {
          setItems((s) => s.filter((f) => f.key !== key));
          toast(`Couldn't attach "${file.name || "the image"}"`, { description: result.message });
        }
      })();
    }
  }, []);

  const remove = useCallback((key: string) => setItems((s) => s.filter((f) => f.key !== key)), []);
  const clear = useCallback(() => setItems([]), []);

  /** Pasted images and files go into the message; pasted text stays text. */
  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const pasted = [...e.clipboardData.files];
      if (!pasted.length) return;
      e.preventDefault();
      add(pasted);
    },
    [add],
  );
  const onDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  }, []);
  const onDrop = useCallback(
    (e: DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      add(e.dataTransfer.files);
    },
    [add],
  );

  const refs = items.flatMap((f) => (f.ref ? [f.ref] : []));
  const uploading = items.some((f) => f.status === "uploading");
  return { items, refs, uploading, add, remove, clear, onPaste, onDragOver, onDrop };
}

export type Attachments = ReturnType<typeof useAttachments>;
