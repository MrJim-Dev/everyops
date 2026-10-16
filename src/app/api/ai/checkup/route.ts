import { z } from "zod";
import { type Checkup, checkupKey } from "@/lib/assistant/checkup";
import { blueprintOf, canEdit } from "@/lib/store/workspace-model";
import { runCheckup } from "@/server/ai/checkup";
import { takeAiToken } from "@/server/ai/rate-limit";
import { enterAiUsage, startAiUsage } from "@/server/ai/usage";
import { apiUser, sameOrigin } from "@/server/session-api";
import { hideFinding, readCheckup, readMemory, saveCheckup } from "@/server/workspace-memory";
import { loadWorkspace, roleIn } from "@/server/workspaces";

/**
 * "Things to fix" for a workspace. The last check is reused until the design or the memory changes (or refresh=1);
 * a new one compares the workspace with its memory through Gemini. People who can change data only.
 */
export async function GET(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const params = new URL(request.url).searchParams;
  const workspaceId = params.get("workspaceId") ?? "";
  const found = await loadWorkspace(workspaceId, user.id);
  if (!found) return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  if (!canEdit(found.role))
    return Response.json({ ok: false, message: "Viewers can't fix things." }, { status: 403 });
  const memory = await readMemory(workspaceId);
  const blueprint = blueprintOf(found.workspace);
  const key = checkupKey(blueprint.version, memory.updatedAt);
  const cached = await readCheckup(workspaceId);
  if (cached && cached.key === key && params.get("refresh") !== "1")
    return Response.json({ ok: true, checkup: cached, cached: true });
  const limit = await takeAiToken(user.id);
  if (!limit.ok)
    return Response.json(
      { ok: false, message: "Checked a lot already. Try again in a few minutes." },
      { status: 429 },
    );
  const overBudget = await startAiUsage(workspaceId);
  if (overBudget) return overBudget;
  enterAiUsage(workspaceId, { userId: user.id, feature: "checkup" });
  try {
    const started = Date.now();
    const findings = await runCheckup({
      blueprint,
      records: found.workspace.records,
      docs: found.workspace.docs,
      memory,
      summary: found.workspace.summary,
      dismissed: cached?.dismissed,
    });
    const checkup: Checkup = { key, findings, checkedAt: new Date().toISOString() };
    await saveCheckup(workspaceId, checkup);
    const saved = (await readCheckup(workspaceId)) ?? checkup;
    console.log(
      JSON.stringify({ event: "checkup_done", ms: Date.now() - started, findings: findings.length }),
    );
    return Response.json({ ok: true, checkup: saved, cached: false });
  } catch (e) {
    console.error(JSON.stringify({ event: "checkup_failed", message: String(e) }));
    return Response.json({ ok: false, message: "Couldn't check the workspace right now." }, { status: 502 });
  }
}

const hideBody = z.object({ workspaceId: z.string().min(1), hide: z.string().regex(/^fix_[a-z0-9]{1,13}$/) });

/** Hides a finding for everyone on the team ("not a problem"), so it stays gone after a reload or a new check. */
export async function POST(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const parsed = hideBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, message: "Invalid request." }, { status: 400 });
  const access = await roleIn(parsed.data.workspaceId, user.id);
  if (!access || !canEdit(access.role))
    return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  await hideFinding(parsed.data.workspaceId, parsed.data.hide);
  return Response.json({ ok: true });
}
