import { actorOf, apiCaller, workspaceAccess } from "@/server/api-auth";
import { db } from "@/server/db";
import { writePageText } from "@/server/record-writes";
import { apiError, badRequest, jsonBody, restRoute } from "@/server/rest";
import { currentBlueprint } from "@/server/workspace-data";
import { enterZone } from "@/server/zone";

type Ctx = RouteContext<"/api/v1/workspaces/[id]/pages/[viewId]">;

/** Longest page text the API saves. */
const MAX_PAGE_CHARS = 1_000_000;

/** A document page's markdown or a custom page's HTML, by its tab id from /schema. */
export async function GET(request: Request, { params }: Ctx) {
  const { id, viewId } = await params;
  return restRoute(request, id, async (call) => Response.json({ data: await call("read_page", { viewId }) }));
}

/**
 * Replaces a page's text: { "text": "…" }. Document pages need pages:write (staff and up); custom HTML pages are
 * code shown to the public, so only owners and admins may change them, as in the app. The text it replaces is kept
 * as a version that can be restored from the page's history.
 */
export async function PUT(request: Request, { params }: Ctx) {
  const { id, viewId } = await params;
  const { caller, error } = await apiCaller(request);
  if (error) return error;
  const access = await workspaceAccess(caller, id, "pages:write");
  if (access.error) return access.error;
  const body = await jsonBody(request);
  if (typeof body?.text !== "string") return badRequest('Send { "text": "…" }.');
  if (body.text.length > MAX_PAGE_CHARS)
    return apiError(
      413,
      "too_large",
      `Page text is limited to ${MAX_PAGE_CHARS.toLocaleString("en-US")} characters.`,
    );
  const bp = await currentBlueprint(db, id);
  enterZone(bp);
  const view = bp?.views.find((v) => v.id === viewId);
  if (!view || (view.type !== "document" && view.type !== "html"))
    return apiError(404, "not_found", `No document or custom HTML page "${viewId}".`);
  if (view.type === "html" && access.role !== "owner" && access.role !== "admin")
    return apiError(
      403,
      "forbidden",
      "Custom HTML pages are shown to the public: only owners and admins can change them.",
    );
  const updatedAt = await writePageText(id, actorOf(caller), viewId, body.text);
  return Response.json({
    data: { id: viewId, name: view.name, type: view.type, characters: body.text.length, updatedAt },
  });
}
