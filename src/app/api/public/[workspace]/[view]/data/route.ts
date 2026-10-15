import { publishedPageData } from "@/lib/public/page-data";
import { allowSubmission, publicPage } from "@/server/public";

/** This endpoint has no signed-in fallback: unpublished views are always unavailable. */
export async function GET(request: Request, { params }: RouteContext<"/api/public/[workspace]/[view]/data">) {
  const { workspace, view } = await params;
  const ip = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const headers = { "Cache-Control": "no-store" };
  if (!allowSubmission(`page-data:${ip}:${workspace}`, 120, 60_000))
    return Response.json(
      { ok: false, message: "Too many requests. Try again shortly." },
      { status: 429, headers },
    );
  const result = await publicPage(workspace, view);
  if (!result || !("page" in result))
    return Response.json(
      { ok: false, message: "This data source isn't published." },
      { status: 404, headers },
    );
  const data = publishedPageData(result.page);
  return Response.json(data, { status: data.ok ? 200 : 400, headers });
}
