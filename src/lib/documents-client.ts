"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DIRECT_UPLOAD_BYTES,
  type DocumentsUsage,
  MAX_DOCUMENT_FILE_BYTES,
  type WorkspaceDocument,
} from "@/lib/documents";

type Result<T> = { ok: true } & T;
type Failure = { ok: false; message: string };

/** Sends a request with upload progress (fetch can't report it), and reads the JSON answer. */
function send(
  method: string,
  url: string,
  body: XMLHttpRequestBodyInit,
  onProgress?: (sent: number) => void,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress?.(e.loaded);
    xhr.onload = () => {
      let json: unknown = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {}
      resolve({ status: xhr.status, json });
    };
    xhr.onerror = () => resolve({ status: 0, json: null });
    xhr.send(body);
  });
}

const failed = (json: unknown, fallback: string): Failure => ({
  ok: false,
  message: (json as { message?: string } | null)?.message ?? fallback,
});

/**
 * Adds a file to a workspace's Documents. Up to 25 MB it goes through the app; bigger files (videos) go straight to
 * storage in a resumable upload, then the app checks what arrived and lists it.
 */
export async function uploadDocument(
  workspaceId: string,
  file: File,
  options: {
    folder?: string | null;
    source?: "upload" | "export";
    onProgress?: (fraction: number) => void;
  } = {},
): Promise<Result<{ document: WorkspaceDocument }> | Failure> {
  const api = `/api/workspaces/${workspaceId}/documents`;
  const progress = (sent: number) => options.onProgress?.(Math.min(1, sent / Math.max(1, file.size)));
  if (file.size > MAX_DOCUMENT_FILE_BYTES) return { ok: false, message: "Files can be up to 500 MB." };
  if (file.size <= DIRECT_UPLOAD_BYTES) {
    const form = new FormData();
    form.set("file", file);
    if (options.folder) form.set("folder", options.folder);
    if (options.source) form.set("source", options.source);
    const { json } = await send("POST", api, form, progress);
    const body = json as { ok?: boolean; document?: WorkspaceDocument } | null;
    return body?.ok && body.document
      ? { ok: true, document: body.document }
      : failed(json, "Couldn't upload it. Try again.");
  }
  const start = await fetch(api, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ start: { filename: file.name, size: file.size } }),
  })
    .then((r) => r.json())
    .catch(() => null);
  if (!start?.ok) return failed(start, "Couldn't start the upload. Try again.");
  const put = await send("PUT", start.uploadUrl, file, progress, {
    "content-type": file.type || "application/octet-stream",
  });
  if (put.status < 200 || put.status >= 300) return { ok: false, message: "The upload stopped. Try again." };
  const finish = await fetch(api, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      finish: { name: start.name, filename: file.name, folder: options.folder ?? null },
    }),
  })
    .then((r) => r.json())
    .catch(() => null);
  return finish?.ok
    ? { ok: true, document: finish.document }
    : failed(finish, "Couldn't save the upload. Try again.");
}

/**
 * Keeps a copy of an export in Documents → Exports, after it has downloaded. Quiet when it can't (a viewer, a
 * preview, a full plan): the download itself already worked.
 */
export async function keepExport(
  workspace: { id: string; mode: "live" | "preview"; basePath: string },
  filename: string,
  blob: Blob,
  canKeep: boolean,
) {
  if (workspace.mode !== "live" || !canKeep) return;
  const result = await uploadDocument(workspace.id, new File([blob], filename, { type: blob.type }), {
    source: "export",
  });
  if (result.ok)
    toast.success("Saved to Documents", {
      description: filename,
      action: {
        label: "Open",
        onClick: () => window.location.assign(`${workspace.basePath}/documents?show=exports`),
      },
    });
}

/** A workspace's Documents and its storage, loaded once and refreshed after changes. */
export function useDocuments(workspaceId: string) {
  const [state, setState] = useState<{
    documents: WorkspaceDocument[];
    usage: DocumentsUsage | null;
    status: "loading" | "ready" | "error";
  }>({ documents: [], usage: null, status: "loading" });
  const load = useCallback(async () => {
    const body = await fetch(`/api/workspaces/${workspaceId}/documents`, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null);
    if (body?.ok) setState({ documents: body.documents, usage: body.usage, status: "ready" });
    else setState((s) => ({ ...s, status: "error" }));
  }, [workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  return {
    ...state,
    reload: load,
    setDocuments: (fn: (d: WorkspaceDocument[]) => WorkspaceDocument[]) =>
      setState((s) => ({ ...s, documents: fn(s.documents) })),
  };
}

export async function renameDocument(
  workspaceId: string,
  name: string,
  patch: { displayName?: string; folder?: string | null },
) {
  const res = await fetch(`/api/workspaces/${workspaceId}/documents`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, ...patch }),
  }).catch(() => null);
  const body = await res?.json().catch(() => null);
  return body?.ok ? { ok: true as const } : failed(body, "Couldn't save that. Try again.");
}

export async function deleteDocument(workspaceId: string, name: string) {
  const res = await fetch(`/api/workspaces/${workspaceId}/documents?name=${encodeURIComponent(name)}`, {
    method: "DELETE",
  }).catch(() => null);
  const body = await res?.json().catch(() => null);
  return body?.ok ? { ok: true as const } : failed(body, "Couldn't delete it. Try again.");
}
