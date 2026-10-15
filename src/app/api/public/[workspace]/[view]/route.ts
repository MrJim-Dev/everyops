import { allowSubmission, submitPublicForm } from "@/server/public";

/** A visitor submits a public form (a booking). No account needed; limited per address. */
export async function POST(request: Request, { params }: RouteContext<"/api/public/[workspace]/[view]">) {
  const { workspace, view } = await params;
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  if (!(await allowSubmission(`${ip}:${workspace}`)))
    return Response.json(
      { ok: false, message: "Too many submissions. Try again in a few minutes." },
      { status: 429 },
    );
  const body = (await request.json().catch(() => null)) as {
    values?: Record<string, unknown>;
    extras?: Record<string, unknown>;
    website?: string;
  } | null;
  if (!body?.values || typeof body.values !== "object")
    return Response.json({ ok: false, message: "Fill in the form first." }, { status: 400 });
  // The hidden "website" field is only ever filled by bots.
  if (body.website) return Response.json({ ok: true, reference: "RECEIVED", title: "", summary: [] });
  const extras = body.extras && typeof body.extras === "object" ? body.extras : {};
  const result = await submitPublicForm(workspace, view, body.values, new Date(), extras);
  return Response.json(result, { status: result.ok ? 200 : result.status });
}
