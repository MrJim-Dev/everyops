import { z } from "zod";
import { checkDomain, removeDomain, setPrimary } from "@/server/domains";
import { managerOf } from "@/server/manager-api";

type Ctx = RouteContext<"/api/workspaces/[id]/domains/[hostname]">;

const body = z.object({ action: z.enum(["check", "primary"]) });

/** Checks a domain's DNS and certificate now ("check"), or makes it the one the others redirect to ("primary"). */
export async function POST(request: Request, { params }: Ctx) {
  const { id, hostname } = await params;
  const { error } = await managerOf(request, id, true);
  if (error) return error;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, message: "Say check or primary." }, { status: 400 });
  const host = decodeURIComponent(hostname).toLowerCase();
  if (parsed.data.action === "primary")
    return (await setPrimary(id, host))
      ? Response.json({ ok: true })
      : Response.json({ ok: false, message: "No such domain." }, { status: 404 });
  const domain = await checkDomain(id, host);
  return domain
    ? Response.json({ ok: true, domain })
    : Response.json({ ok: false, message: "No such domain." }, { status: 404 });
}

/** Removes a domain: its certificate and map entry go too, and the host stops serving at once. */
export async function DELETE(request: Request, { params }: Ctx) {
  const { id, hostname } = await params;
  const { user, error } = await managerOf(request, id, true);
  if (error) return error;
  const done = await removeDomain(id, decodeURIComponent(hostname).toLowerCase(), user.id);
  return done.ok
    ? Response.json(done)
    : Response.json({ ok: false, message: "No such domain." }, { status: 404 });
}
