import { z } from "zod";
import { DIRECT_UPLOAD_BYTES } from "@/lib/documents";
import { canEdit, canManage } from "@/lib/store/workspace-model";
import {
  addDocument,
  documentInfo,
  finishLargeUpload,
  listDocuments,
  removeDocument,
  startLargeUpload,
  updateDocument,
} from "@/server/documents";
import { apiUser, sameOrigin } from "@/server/session-api";
import { storageLimitResult } from "@/server/storage-usage";
import { roleIn } from "@/server/workspaces";

type Context = RouteContext<"/api/workspaces/[id]/documents">;

async function access(request: Request, context: Context, write: boolean) {
  const { user, error } = await apiUser(request);
  if (error) return { error };
  if (write && !sameOrigin(request))
    return { error: Response.json({ ok: false, message: "Forbidden" }, { status: 403 }) };
  const { id } = await context.params;
  const found = await roleIn(id, user.id);
  if (!found) return { error: Response.json({ ok: false, message: "Not found" }, { status: 404 }) };
  if (write && !canEdit(found.role))
    return {
      error: Response.json({ ok: false, message: "Viewers can't change Documents." }, { status: 403 }),
    };
  return { user, id, role: found.role };
}

/** Every file the workspace keeps, for anyone on its team, with how much of the workspace's storage they take. */
export async function GET(request: Request, context: Context) {
  const a = await access(request, context, false);
  if (a.error) return a.error;
  return Response.json({ ok: true, ...(await listDocuments(a.id)) });
}

/**
 * Adds a file. multipart/form-data with file (up to 25 MB), optional folder and source ("export" for a kept export).
 * JSON {start: {filename, size}} opens a direct upload for bigger files (videos); {finish: {name, filename}} lists
 * it once it has arrived.
 */
export async function POST(request: Request, context: Context) {
  const a = await access(request, context, true);
  if (a.error) return a.error;
  const by = { id: a.user.id, name: a.user.name };
  try {
    if (request.headers.get("content-type")?.includes("application/json")) {
      const body = z
        .object({
          start: z.object({ filename: z.string().max(300), size: z.number().int().positive() }).optional(),
          finish: z
            .object({
              name: z.string().max(200),
              filename: z.string().max(300),
              folder: z.string().max(60).nullish(),
            })
            .optional(),
        })
        .safeParse(await request.json().catch(() => null));
      if (!body.success) return Response.json({ ok: false, message: "Choose a file." }, { status: 400 });
      if (body.data.start) {
        const origin = request.headers.get("origin") ?? new URL(request.url).origin;
        const started = await startLargeUpload(a.id, body.data.start.filename, body.data.start.size, origin);
        return Response.json(started, { status: started.ok ? 200 : 400 });
      }
      if (body.data.finish) {
        const { name, filename, folder } = body.data.finish;
        const done = await finishLargeUpload(a.id, name, filename, { folder, by });
        return Response.json(done, { status: done.ok ? 200 : 400 });
      }
      return Response.json({ ok: false, message: "Choose a file." }, { status: 400 });
    }
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob))
      return Response.json({ ok: false, message: "Choose a file." }, { status: 400 });
    if (file.size > DIRECT_UPLOAD_BYTES)
      return Response.json(
        { ok: false, message: "Send files over 25 MB as a direct upload." },
        { status: 413 },
      );
    const source = form?.get("source") === "export" ? "export" : "upload";
    const document = await addDocument(
      a.id,
      new Uint8Array(await file.arrayBuffer()),
      file instanceof File ? file.name : String(form?.get("filename") ?? "File"),
      { source, folder: form?.get("folder") ? String(form.get("folder")) : null, by },
    );
    if (!document)
      return Response.json(
        { ok: false, message: "Documents takes PDFs, Office files, CSV, text, pictures, videos and audio." },
        { status: 415 },
      );
    return Response.json({ ok: true, document });
  } catch (error) {
    const limit = storageLimitResult(error);
    return Response.json(limit, { status: limit.status });
  }
}

const patchBody = z.object({
  name: z.string().max(200),
  displayName: z.string().min(1).max(120).optional(),
  folder: z.string().max(60).nullable().optional(),
});

/** Renames a file or moves it to a folder: whoever added it, or an owner or admin. */
export async function PATCH(request: Request, context: Context) {
  const a = await access(request, context, true);
  if (a.error) return a.error;
  const body = patchBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, message: "Check the name." }, { status: 400 });
  const info = await documentInfo(a.id, body.data.name);
  if (!info) return Response.json({ ok: false, message: "Not found" }, { status: 404 });
  if (!canManage(a.role) && info.addedBy !== a.user.id)
    return Response.json(
      { ok: false, message: "Only whoever added it, or an admin, can change it." },
      { status: 403 },
    );
  await updateDocument(a.id, body.data.name, body.data);
  return Response.json({ ok: true });
}

/** Deletes an uploaded or exported file: whoever added it, or an owner or admin. */
export async function DELETE(request: Request, context: Context) {
  const a = await access(request, context, true);
  if (a.error) return a.error;
  const name = new URL(request.url).searchParams.get("name") ?? "";
  const info = await documentInfo(a.id, name);
  if (!info) return Response.json({ ok: false, message: "Not found" }, { status: 404 });
  if (info.source === "record")
    return Response.json(
      { ok: false, message: "This file is on a record. Remove it from the record instead." },
      { status: 400 },
    );
  if (!canManage(a.role) && info.addedBy !== a.user.id)
    return Response.json(
      { ok: false, message: "Only whoever added it, or an admin, can delete it." },
      { status: 403 },
    );
  await removeDocument(a.id, name);
  return Response.json({ ok: true });
}
