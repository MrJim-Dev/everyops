import { PROVIDER_IDS, PROVIDERS } from "@/lib/connections";
import { googleReady, listActions, listConnections } from "@/server/connections";
import { managerOf } from "@/server/manager-api";

/** The vetted outside services, which are connected, and recent proposed outside actions; owners and admins only. */
export async function GET(request: Request, { params }: RouteContext<"/api/workspaces/[id]/connections">) {
  const { id } = await params;
  const { error } = await managerOf(request, id);
  if (error) return error;
  const [connected, actions] = await Promise.all([listConnections(id), listActions(id)]);
  return Response.json({
    ok: true,
    available: googleReady(),
    providers: PROVIDER_IDS.map((p) => ({
      id: p,
      name: PROVIDERS[p].name,
      description: PROVIDERS[p].description,
      reads: PROVIDERS[p].readTools,
      writes: PROVIDERS[p].writeTools,
      connection: connected.find((c) => c.provider === p) ?? null,
    })),
    actions,
  });
}
