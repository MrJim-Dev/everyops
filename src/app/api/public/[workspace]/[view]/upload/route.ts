import { allowSubmission, uploadPublicImage } from "@/server/public";
import { MAX_UPLOAD_BYTES } from "@/server/storage";

/** A visitor uploads a picture a public form asks for (a proof of payment). No account needed; limited per address. */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/public/[workspace]/[view]/upload">,
) {
  const { workspace, view } = await params;
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  if (!allowSubmission(`upload:${ip}:${workspace}`, 12))
    return Response.json(
      { ok: false, message: "Too many uploads. Try again in a few minutes." },
      { status: 429 },
    );
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob))
    return Response.json({ ok: false, message: "Choose a file." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES)
    return Response.json({ ok: false, message: "That picture is over 5 MB." }, { status: 413 });
  const result = await uploadPublicImage(workspace, view, new Uint8Array(await file.arrayBuffer()));
  return Response.json(result, { status: result.ok ? 200 : result.status });
}
