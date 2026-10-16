import { z } from "zod";
import { APP_DOMAIN, parseHostname } from "@/lib/domains";
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
    subdomain: `${id.replace(/-[a-z0-9]{4}$/, "").slice(0, 40)}.${APP_DOMAIN}`,
  });
}

const body = z.object({
  hostname: z.string().max(260),
  target: z.string().min(1).max(80).default("home"),
  subdomain: z.boolean().optional(),
});

/** Adds a custom domain (or the free subdomain) serving the public home or one public page. */
export async function POST(request: Request, { params }: RouteContext<"/api/workspaces/[id]/domains">) {
  const { id } = await params;
  const { user, error } = await managerOf(request, id, true);
  if (error) return error;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, message: "Enter a domain." }, { status: 400 });
  const bp = await currentBlueprint(db, id);
  if (parsed.data.target !== "home" && !bp?.views.some((v) => v.id === parsed.data.target))
    return Response.json({ ok: false, message: "Pick a public page for it to show." }, { status: 400 });
  let host: string;
  if (parsed.data.subdomain) {
    const label = parsed.data.hostname.trim().toLowerCase().replace(/\..*$/, "");
    if (
      !/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(label) ||
      ["www", "app", "api", "domains", "mail"].includes(label)
    )
      return Response.json({ ok: false, message: "Use 3 to 40 letters, digits or dashes." }, { status: 400 });
    host = `${label}.${APP_DOMAIN}`;
  } else {
    const parsedHost = parseHostname(parsed.data.hostname);
    if (!parsedHost.ok) return Response.json({ ok: false, message: parsedHost.message }, { status: 400 });
    host = parsedHost.host;
  }
  const added = await addDomain(
    id,
    user.id,
    host,
    parsed.data.target,
    parsed.data.subdomain ? "subdomain" : "custom",
  );
  return added.ok ? Response.json({ ok: true, domain: added.domain }) : Response.json(added, { status: 400 });
}
