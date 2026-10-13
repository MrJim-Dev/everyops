import { publicSlots } from "@/server/public";

/** Free and taken slots for one resource on one day, for a public booking form. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/public/[workspace]/[view]/slots">,
) {
  const { workspace, view } = await params;
  const url = new URL(request.url);
  const slots = await publicSlots(
    workspace,
    view,
    url.searchParams.get("resource") ?? "",
    url.searchParams.get("date") ?? "",
  );
  if (!slots) return Response.json({ ok: false, message: "No schedule for that." }, { status: 404 });
  return Response.json({ ok: true, slots }, { headers: { "cache-control": "no-store" } });
}
