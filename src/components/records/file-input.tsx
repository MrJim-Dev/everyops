"use client";

import { FileIcon, TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { FILE_ACCEPT, fileName } from "@/lib/blueprint/contact";
import type { Field, FieldValue } from "@/lib/blueprint/types";
import { uploadFile } from "@/lib/uploads";

/** Picks a document (PDF, Office file, CSV, text or picture, up to 10 MB), uploads it and stores its link. */
export function FileInput({
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
      onChange(await uploadFile(file, ws));
    } catch (error) {
      toast.error("Couldn't upload the file", { description: (error as Error).message });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {value ? (
          <span className="inline-flex max-w-[260px] items-center gap-1.5 truncate rounded-md border bg-muted/40 px-2 py-1 text-[13px]">
            <FileIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{fileName(value)}</span>
          </span>
        ) : null}
        <input
          ref={input}
          id={id}
          type="file"
          accept={FILE_ACCEPT}
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
          {busy ? "Uploading…" : value ? "Replace" : `Upload ${field.name.toLowerCase()}`}
        </Button>
        {value ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange(null)}
            aria-label={`Remove ${field.name}`}
          >
            <TrashIcon />
          </Button>
        ) : null}
      </div>
      <span className="text-[12px] text-muted-foreground">
        PDF, Word, Excel, PowerPoint, CSV, text or a picture, up to 10 MB.
      </span>
    </div>
  );
}
