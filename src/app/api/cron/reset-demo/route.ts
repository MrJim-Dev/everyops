import { timingSafeEqual } from "node:crypto";
import { resetDemoAccount } from "@/server/demo";

/** Called nightly by Cloud Scheduler with "Authorization: Bearer $CRON_SECRET". */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const ok =
    !!secret && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return Response.json({ ok: false }, { status: 401 });
  const result = await resetDemoAccount();
  console.info(JSON.stringify({ event: "reset-demo", ...result }));
  return Response.json(result, { status: result.ok ? 200 : 404 });
}
