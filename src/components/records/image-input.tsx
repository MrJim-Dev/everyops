"use client";

import { ImageIcon, TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { Field, FieldValue } from "@/lib/blueprint/types";
import { uploadImage } from "@/lib/uploads";

/** Picks an image, uploads it to the workspace's storage and stores its link. Previews keep it in the browser. */
export function ImageInput({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: Field;
  value: string | null;
  onChange: (value: FieldValue) => void;
}) {
  const ws = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await uploadImage(file, ws));
    } catch (error) {
      toast.error("Couldn't upload the image", { description: (error as Error).message });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
        {value ? (
          // biome-ignore lint/performance/noImgElement: a small preview of the upload
          <img src={value} alt={field.name} className="size-full bg-white object-contain" />
        ) : (
          <ImageIcon className="size-5 text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
          className="sr-only"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <UploadSimpleIcon data-icon="inline-start" />
          {busy ? "Uploading…" : value ? "Replace" : "Upload image"}
        </Button>
        {value ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
            <TrashIcon data-icon="inline-start" />
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}
