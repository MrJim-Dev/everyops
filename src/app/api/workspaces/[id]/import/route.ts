import { canEdit } from "@/lib/store/workspace-model";
import { apiUser, sameOrigin } from "@/server/session-api";
import { MAX_IMPORT_BYTES, readGoogleSheet, readSpreadsheet } from "@/server/spreadsheet-import";
import { roleIn } from "@/server/workspaces";

/**
 * Reads a spreadsheet for the import dialog: an uploaded CSV or Excel file (form field "file"), or a Google Sheets
 * link (JSON { url }). Answers with each sheet's header and rows as text; the browser matches columns, checks rows and
 * applies the import as one undoable change, the same way it saves any edit. Nothing is stored here.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/workspaces/[id]/import">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const access = await roleIn(id, user.id);
  if (!access) return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  if (!canEdit(access.role))
    return Response.json({ ok: false, message: "Viewers can't import records." }, { status: 403 });
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
    if (typeof body?.url !== "string")
      return Response.json({ ok: false, message: "Paste a Google Sheets link." }, { status: 400 });
    const result = await readGoogleSheet(body.url);
    return Response.json(result, { status: result.ok ? 200 : 422 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_IMPORT_BYTES + 64_000)
    return Response.json({ ok: false, message: "That file is over 10 MB." }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File))
    return Response.json({ ok: false, message: "Choose a CSV or Excel file." }, { status: 400 });
  const result = await readSpreadsheet(file.name, new Uint8Array(await file.arrayBuffer()));
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
