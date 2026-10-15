import { type Checkup, checkupKey } from "@/lib/assistant/checkup";
import { blueprintOf, canEdit } from "@/lib/store/workspace-model";
import { runCheckup } from "@/server/ai/checkup";
import { takeAiToken } from "@/server/ai/rate-limit";
import { apiUser } from "@/server/session-api";
import { readCheckup, readMemory, saveCheckup } from "@/server/workspace-memory";
import { loadWorkspace } from "@/server/workspaces";

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
  try {
    const started = Date.now();
    const findings = await runCheckup({
      blueprint,
      records: found.workspace.records,
      docs: found.workspace.docs,
      memory,
      summary: found.workspace.summary,
    });
    const checkup: Checkup = { key, findings, checkedAt: new Date().toISOString() };
    await saveCheckup(workspaceId, checkup);
    console.log(
      JSON.stringify({ event: "checkup_done", ms: Date.now() - started, findings: findings.length }),
    );
    return Response.json({ ok: true, checkup, cached: false });
  } catch (e) {
    console.error(JSON.stringify({ event: "checkup_failed", message: String(e) }));
    return Response.json({ ok: false, message: "Couldn't check the workspace right now." }, { status: 502 });
  }
}
