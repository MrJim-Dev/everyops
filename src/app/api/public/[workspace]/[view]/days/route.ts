import { publicDays } from "@/server/public";

/** Free and taken days for one resource, for a public form that books whole days (stays, rentals). */
export async function GET(request: Request, { params }: RouteContext<"/api/public/[workspace]/[view]/days">) {
  const { workspace, view } = await params;
  const url = new URL(request.url);
  const days = await publicDays(
    workspace,
    view,
    url.searchParams.get("resource") ?? "",
    url.searchParams.get("from") ?? "",
    Number(url.searchParams.get("count") ?? 42),
  );
  if (!days) return Response.json({ ok: false, message: "No calendar for that." }, { status: 404 });
  return Response.json({ ok: true, days }, { headers: { "cache-control": "no-store" } });
}
