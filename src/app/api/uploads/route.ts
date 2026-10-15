import { canEdit } from "@/lib/store/workspace-model";
import { apiUser, sameOrigin } from "@/server/session-api";
import { MAX_DOCUMENT_BYTES, MAX_UPLOAD_BYTES, saveDocument, saveImage } from "@/server/storage";
import { roleIn } from "@/server/workspaces";

/**
 * Uploads one image (a QR code, a logo) or, with kind=file, one document for a file field (a PDF receipt, a
 * contract) to a workspace the caller can edit. Returns the path to store in the field.
 */
export async function POST(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const workspaceId = String(form?.get("workspaceId") ?? "");
  const document = form?.get("kind") === "file";
  if (!(file instanceof Blob) || !workspaceId)
    return Response.json(
      { ok: false, message: `Choose ${document ? "a file" : "an image"} to upload.` },
      { status: 400 },
    );
  const max = document ? MAX_DOCUMENT_BYTES : MAX_UPLOAD_BYTES;
  if (file.size > max)
    return Response.json(
      { ok: false, message: `That ${document ? "file" : "image"} is over ${max / 1_000_000} MB.` },
      { status: 413 },
    );
  const access = await roleIn(workspaceId, user.id);
  if (!access || !canEdit(access.role))
    return Response.json({ ok: false, message: "You can't upload to this workspace." }, { status: 403 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const url = document
    ? await saveDocument(workspaceId, bytes, file instanceof File ? file.name : "File")
    : await saveImage(workspaceId, bytes);
  if (!url)
    return Response.json(
      {
        ok: false,
        message: document
          ? "Upload a PDF, Word, Excel, PowerPoint, CSV, text file or picture."
          : "Upload a PNG, JPG, WebP or GIF image.",
      },
      { status: 415 },
    );
  return Response.json({ ok: true, url });
}
