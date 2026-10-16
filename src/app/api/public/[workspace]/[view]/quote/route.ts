import { allowSubmission, quotePublicForm } from "@/server/public";

/** What a visitor's booking comes to before sending it. Nothing is saved. Limited per address. */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/public/[workspace]/[view]/quote">,
) {
  const { workspace, view } = await params;
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  if (!(await allowSubmission(`quote:${ip}:${workspace}`, 60)))
    return Response.json({ ok: false, message: "Too many requests." }, { status: 429 });
  const body = (await request.json().catch(() => null)) as {
    values?: Record<string, unknown>;
    extras?: Record<string, unknown>;
  } | null;
  if (!body?.values || typeof body.values !== "object")
    return Response.json({ ok: false, message: "Nothing to price yet." }, { status: 400 });
  const extras = body.extras && typeof body.extras === "object" ? body.extras : {};
  const result = await quotePublicForm(workspace, view, body.values, extras);
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
