import { ACTIONS, ACTOR_TYPES, activityCsv, RESULTS } from "@/lib/activity";
import { canManage } from "@/lib/store/workspace-model";
import { addDays, at } from "@/lib/time";
import { activityActors, listActivity } from "@/server/activity";
import { db } from "@/server/db";
import { apiUser } from "@/server/session-api";
import { currentBlueprint } from "@/server/workspace-data";
import { roleIn } from "@/server/workspaces";
import { enterZone } from "@/server/zone";

const pick = <T extends string>(value: string | null, allowed: readonly T[]) =>
  value && (allowed as readonly string[]).includes(value) ? (value as T) : null;

/** A calendar day (YYYY-MM-DD) on the workspace's clock as the instant it starts; with next, the day after's. */
const manilaDay = (value: string | null, next = false) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(at(next ? addDays(value, 1) : value, "00:00"));
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The workspace's activity log for its owners and admins, newest first: ?actorType=&actor=&action=&result=&from=
 * &to= (days on the workspace's clock) &before=<id> for the next page, &format=csv to download (up to 5,000 entries).
 */
export async function GET(request: Request, { params }: RouteContext<"/api/workspaces/[id]/activity">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const { id } = await params;
  const access = await roleIn(id, user.id);
  if (!access) return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  if (!canManage(access.role))
    return Response.json(
      { ok: false, message: "Only owners and admins can see the activity log." },
      { status: 403 },
    );
  const p = new URL(request.url).searchParams;
  enterZone(await currentBlueprint(db, id));
  const action = p.get("action");
  const csv = p.get("format") === "csv";
  const filter = {
    actorType: pick(p.get("actorType"), ACTOR_TYPES),
    actorId: p.get("actor")?.slice(0, 200) || null,
    action: action && (action in ACTIONS || /^[a-z]+\.$/.test(action)) ? action : null,
    result: pick(p.get("result"), RESULTS),
    from: manilaDay(p.get("from")),
    to: manilaDay(p.get("to"), true),
    before: Number(p.get("before")) || null,
    limit: csv ? 5000 : 50,
  };
  const items = await listActivity(id, filter);
  if (csv)
    return new Response(activityCsv(items), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${id}-activity.csv"`,
      },
    });
  return Response.json({
    ok: true,
    items,
    next: items.length === 50 ? items[items.length - 1].id : null,
    ...(p.get("actors") ? { actors: await activityActors(id) } : {}),
  });
}
