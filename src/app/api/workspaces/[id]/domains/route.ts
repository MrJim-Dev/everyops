import { z } from "zod";
import { parseHostname } from "@/lib/domains";
import { db } from "@/server/db";
import { addDomain, listDomains, platformReady, targets } from "@/server/domains";
import { managerOf } from "@/server/manager-api";
import { currentBlueprint } from "@/server/workspace-data";

/** The workspace's domains with their DNS records and status, and what they can serve; owners and admins only. */
export async function GET(request: Request, { params }: RouteContext<"/api/workspaces/[id]/domains">) {
  const { id } = await params;
  const { error } = await managerOf(request, id);
  if (error) return error;
  const bp = await currentBlueprint(db, id);
  const pages = (bp?.views ?? [])
    .filter(
      (v) =>
        (v.type === "form" || v.type === "landing" || v.type === "html" || v.type === "layout") &&
        "public" in v &&
        v.public,
    )
    .map((v) => ({ id: v.id, name: v.name }));
  return Response.json({
    ok: true,
    domains: await listDomains(id),
    pages,
    platformReady: platformReady(),
    targets: targets(),
  });
}

const body = z.object({
  hostname: z.string().max(260),
  target: z.string().min(1).max(80).default("home"),
});

/** Adds a custom domain serving the public home or one public page. */
export async function POST(request: Request, { params }: RouteContext<"/api/workspaces/[id]/domains">) {
  const { id } = await params;
  const { user, error } = await managerOf(request, id, true);
  if (error) return error;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, message: "Enter a domain." }, { status: 400 });
  const bp = await currentBlueprint(db, id);
  if (parsed.data.target !== "home" && !bp?.views.some((v) => v.id === parsed.data.target))
    return Response.json({ ok: false, message: "Pick a public page for it to show." }, { status: 400 });
  const parsedHost = parseHostname(parsed.data.hostname);
  if (!parsedHost.ok) return Response.json({ ok: false, message: parsedHost.message }, { status: 400 });
  const added = await addDomain(id, user.id, parsedHost.host, parsed.data.target);
  return added.ok ? Response.json({ ok: true, domain: added.domain }) : Response.json(added, { status: 400 });
}
