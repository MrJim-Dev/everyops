"use client";

import { useState } from "react";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { SIGNATURE_FILE } from "@/lib/blueprint/contact";
import type { Field } from "@/lib/blueprint/types";
import { SignaturePad } from "./signature-pad";

const asDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read the signature."));
    reader.readAsDataURL(blob);
  });

/**
 * A signature field in the app: signed on the pad and stored as a PNG in the workspace's private documents. Previews
 * keep it in the page instead, since nothing is saved.
 */
export function SignatureInput({
  id,
  field,
  value,
  invalid,
  onChange,
}: {
  id?: string;
  field: Field;
  value: string | null;
  invalid?: boolean;
  onChange: (value: string | null) => void;
}) {
  const ws = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signed = async (png: Blob | null) => {
    setError(null);
    if (!png) return onChange(null);
    setBusy(true);
    try {
      if (ws.mode === "preview") return onChange(await asDataUrl(png));
      const form = new FormData();
      form.set("file", new File([png], SIGNATURE_FILE, { type: "image/png" }));
      form.set("workspaceId", ws.id);
      form.set("kind", "file");
      const res = await fetch("/api/uploads", { method: "POST", body: form }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as {
        ok: boolean;
        url?: string;
        message?: string;
      } | null;
      if (!body?.ok || !body.url)
        throw new Error(body?.message ?? "Couldn't save the signature. Sign again.");
      onChange(body.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the signature. Sign again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <SignaturePad
        id={id}
        value={value}
        label={field.name}
        invalid={invalid}
        busy={busy}
        saved={!!value && !error}
        onSigned={signed}
      />
      {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
    </div>
  );
}
