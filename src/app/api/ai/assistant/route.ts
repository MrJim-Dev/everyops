import { z } from "zod";
import { attachmentRef } from "@/lib/assistant/attachments";
import { appliesOnItsOwn } from "@/lib/assistant/permissions";
import { screenSchema } from "@/lib/assistant/screen";
import { blueprintOf, canEdit, canManage } from "@/lib/store/workspace-model";
import { assistantTurn } from "@/server/ai/assistant";
import { noteMemory } from "@/server/ai/memory";
import { takeAiToken } from "@/server/ai/rate-limit";
import { apiUser, sameOrigin } from "@/server/session-api";
import { readMemory, rememberEdits } from "@/server/workspace-memory";
import { loadTeam, loadWorkspace } from "@/server/workspaces";

const body = z.object({
  workspaceId: z.string().min(1),
  screen: screenSchema.default({ area: "home" }),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(4000),
        attachments: z.array(attachmentRef).max(5).optional(),
      }),
    )
    .min(1)
    .max(30)
    .refine((m) => m.reduce((n, t) => n + (t.attachments?.length ?? 0), 0) <= 12, "Too many files"),
});

/**
 * The workspace assistant. It reads the workspace from the database, so it sees what the person can see.
 * The answer streams as JSON lines: { type: "status", text } while it works, then { type: "result", … }.
 */
export async function POST(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, message: "Ask something first." }, { status: 400 });
  const found = await loadWorkspace(parsed.data.workspaceId, user.id);
  if (!found) return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  const limit = await takeAiToken(user.id);
  if (!limit.ok)
    return Response.json(
      { ok: false, message: "That's a lot of questions. Wait a few minutes and try again." },
      { status: 429 },
    );
  const manager = canManage(found.role);
  const workspaceId = parsed.data.workspaceId;
  const [team, memory] = await Promise.all([
    manager ? loadTeam(workspaceId) : undefined,
    readMemory(workspaceId),
  ]);
  const blueprint = blueprintOf(found.workspace);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: object) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      // What this message adds to the workspace's memory, worked out beside the answer so it costs no waiting.
      // Viewers only read; what they say isn't kept.
      const remembering =
        canEdit(found.role) && memory.permissions.learn
          ? noteMemory({
              memory,
              workspaceName: found.workspace.name,
              pages: blueprint.systems.map((s) => s.name),
              messages: parsed.data.messages,
              signal: request.signal,
            })
              .then((edits) => (edits.length ? rememberEdits(workspaceId, edits) : null))
              .catch((e) => {
                console.warn(JSON.stringify({ event: "assistant_memory_failed", message: String(e) }));
                return null;
              })
          : Promise.resolve(null);
      try {
        const turn = await assistantTurn({
          blueprint,
          records: found.workspace.records,
          messages: parsed.data.messages,
          screen: parsed.data.screen,
          docs: found.workspace.docs,
          canDesign: manager,
          canEditRecords: canEdit(found.role),
          userId: user.id,
          workspaceId,
          team,
          workspaceName: found.workspace.name,
          summary: found.workspace.summary,
          memory,
          onStatus: (text) => send({ type: "status", text }),
        });
        // Read only: whatever Gemini planned anyway is dropped, never offered.
        const result =
          turn.ok && turn.plan && memory.permissions.autonomy === "read_only"
            ? {
                ok: true as const,
                kind: "answer" as const,
                reply:
                  "I'm set to read only in this workspace, so I can't prepare changes. An owner or admin can allow them in Settings → Assistant.",
                suggestions: [],
              }
            : turn;
        // The plan was checked like any other; the browser applies it straight away (saved to History, undoable).
        const autoApply = result.ok && !!result.plan && appliesOnItsOwn(result.plan, memory.permissions);
        // Usually done long before the answer; never hold the answer more than a few seconds for it.
        const noted = await Promise.race([
          remembering,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
        ]);
        const remembered = noted ? [...noted.added, ...noted.updated].map((n) => n.text) : [];
        send({
          type: "result",
          ...result,
          ...(result.ok && remembered.length ? { remembered } : {}),
          ...(autoApply ? { autoApply } : {}),
        });
      } catch (e) {
        console.error(JSON.stringify({ event: "assistant_failed", message: String(e) }));
        send({ type: "result", ok: false, message: "Something went wrong. Try again." });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
