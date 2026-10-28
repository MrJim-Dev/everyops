import { z } from "zod";
import { isDemoEmail } from "@/lib/auth/demo";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import { windowRecords } from "@/lib/engine/window";
import { blueprintOf, type ChangeEntry, type Invite, type Member } from "@/lib/store/workspace-model";
import type { WorkspacePatch } from "@/lib/store/workspace-sync";
import { jsonResponse } from "@/server/json-response";
import { apiUser, sameOrigin } from "@/server/session-api";
import { loadWorkspace, MAX_PATCH_BYTES, patchWorkspace, removeWorkspace } from "@/server/workspaces";

/**
 * The whole workspace (records, versions, history, page text) with each record's rev, when it opens. Large record
 * types come as a recent window; their tables page on the server (src/lib/engine/window.ts).
 */
export async function GET(request: Request, { params }: RouteContext<"/api/workspaces/[id]">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const found = await loadWorkspace((await params).id, user.id);
  if (!found) return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  const ws = found.workspace;
  const { rows, windowed } = windowRecords(
    blueprintOf(ws),
    ws.records.map((record) => ({ record })),
    new Date(),
  );
  if (!Object.keys(windowed).length)
    return jsonResponse(request, { ok: true, workspace: ws, revs: found.revs });
  const records = rows.map((r) => r.record);
  const kept = new Set(records.map((r) => r.id));
  return jsonResponse(request, {
    ok: true,
    workspace: { ...ws, records, windowed },
    revs: Object.fromEntries(Object.entries(found.revs).filter(([id]) => kept.has(id))),
  });
}

const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Not a date");
const record = z.object({
  id: z.string().min(1).max(200),
  entityId: z.string().min(1).max(200),
  data: z.record(z.string(), z.unknown()),
  createdAt: iso,
  updatedAt: iso,
});
const json = z.record(z.string(), z.unknown());
const page = z.object({ body: z.string(), updatedAt: z.string() });
const patchSchema = z.object({
  create: z.boolean().optional(),
  meta: z
    .object({
      name: z.string().min(1).max(200),
      summary: z.string().max(4000),
      createdAt: z.string(),
      openedAt: z.string(),
      currentVersion: z.number().int().min(1),
      source: z
        .object({
          systemId: z.string(),
          version: z.string(),
          // How it was built from that system; Community counts copies and setups, not starters.
          via: z.enum(["starter", "copy", "setup"]).optional(),
        })
        .optional(),
      setup: json.optional(),
    })
    .optional(),
  versions: z
    .array(z.object({ version: z.number().int().min(1), blueprint: json }))
    .max(500)
    .optional(),
  records: z
    .object({
      put: z.array(z.object({ record, rev: z.number().int().nullable() })),
      delete: z.array(z.object({ id: z.string().min(1).max(200), rev: z.number().int() })),
    })
    .optional(),
  pages: z.record(z.string().max(200), page.nullable()).optional(),
  changes: z.array(json.and(z.object({ id: z.string().min(1), appliedAt: iso }))).optional(),
  team: z.object({ members: z.array(json), invites: z.array(json) }).optional(),
});

/** Saves what changed (src/lib/store/workspace-sync.ts). 409 with conflicts means: merge and save again. */
export async function PATCH(request: Request, { params }: RouteContext<"/api/workspaces/[id]">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const raw = await request.text();
  if (raw.length > MAX_PATCH_BYTES)
    return Response.json({ ok: false, message: "This change is too large to save." }, { status: 413 });
  let parsed: ReturnType<typeof patchSchema.safeParse>;
  try {
    parsed = patchSchema.safeParse(JSON.parse(raw));
  } catch {
    return Response.json({ ok: false, message: "Invalid change." }, { status: 400 });
  }
  if (!parsed.success) return Response.json({ ok: false, message: "Invalid change." }, { status: 400 });
  const patch = parsed.data as unknown as WorkspacePatch & {
    versions?: { version: number; blueprint: Blueprint }[];
    records?: { put: { record: DataRecord; rev: number | null }[] };
    changes?: ChangeEntry[];
    team?: { members: Member[]; invites: Invite[] };
  };
  const result = await patchWorkspace(user.id, id, patch, { demo: isDemoEmail(user.email) });
  return Response.json(result, { status: result.ok ? 200 : result.status });
}

/** Whole-document saves from a tab opened before patches existed: it has to reload to keep saving. */
export async function PUT() {
  return Response.json(
    { ok: false, message: "EveryOps was updated. Reload the page to keep saving.", reload: true },
    { status: 409 },
  );
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/workspaces/[id]">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const result = await removeWorkspace(user.id, (await params).id);
  return Response.json(result, { status: result.ok ? 200 : result.status });
}
