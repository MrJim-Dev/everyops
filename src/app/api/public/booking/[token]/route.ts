import { attachToBooking, managedBooking } from "@/server/manage";
import { allowSubmission } from "@/server/public";
import { MAX_UPLOAD_BYTES } from "@/server/storage";

const ipOf = (request: Request) =>
  (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";

/** One booking, for the visitor holding its manage link. */
export async function GET(request: Request, { params }: RouteContext<"/api/public/booking/[token]">) {
  if (!allowSubmission(`manage-read:${ipOf(request)}`, 120, 60_000))
    return Response.json(
      { ok: false, message: "Too many requests. Try again in a minute." },
      { status: 429 },
    );
  const result = await managedBooking((await params).token);
  return Response.json(result, {
    status: result.ok ? 200 : result.status,
    headers: { "cache-control": "no-store" },
  });
}

/** Adds a picture the booking's form asks for (fieldId, file), e.g. a proof of payment sent later. */
export async function POST(request: Request, { params }: RouteContext<"/api/public/booking/[token]">) {
  if (!allowSubmission(`manage-upload:${ipOf(request)}`, 12))
    return Response.json(
      { ok: false, message: "Too many uploads. Try again in a few minutes." },
      { status: 429 },
    );
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const fieldId = String(form?.get("fieldId") ?? "");
  if (!(file instanceof Blob) || !fieldId)
    return Response.json({ ok: false, message: "Choose a picture." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES)
    return Response.json({ ok: false, message: "That picture is over 5 MB." }, { status: 413 });
  const result = await attachToBooking(
    (await params).token,
    fieldId,
    new Uint8Array(await file.arrayBuffer()),
  );
  return Response.json(result, { status: result.ok ? 200 : result.status });
}
