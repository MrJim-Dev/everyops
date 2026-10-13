import { canEdit } from "@/lib/store/workspace-model";
import { apiUser, sameOrigin } from "@/server/session-api";
import { MAX_UPLOAD_BYTES, saveImage } from "@/server/storage";
import { roleIn } from "@/server/workspaces";

/** Uploads one image (a QR code, a logo) for a workspace the caller can edit. Returns the path to store in a field. */
export async function POST(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const workspaceId = String(form?.get("workspaceId") ?? "");
  if (!(file instanceof Blob) || !workspaceId)
    return Response.json({ ok: false, message: "Choose an image to upload." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES)
    return Response.json({ ok: false, message: "That image is over 5 MB." }, { status: 413 });
  const access = await roleIn(workspaceId, user.id);
  if (!access || !canEdit(access.role))
    return Response.json({ ok: false, message: "You can't upload to this workspace." }, { status: 403 });
  const url = await saveImage(workspaceId, new Uint8Array(await file.arrayBuffer()));
  if (!url)
    return Response.json({ ok: false, message: "Upload a PNG, JPG, WebP or GIF image." }, { status: 415 });
  return Response.json({ ok: true, url });
}
