import { planUsage } from "@/server/billing/account";
import { apiUser } from "@/server/session-api";

/** The signed-in account's plan and how much of each limit it has used (Account → Plan & usage). */
export async function GET(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  return Response.json({ ok: true, usage: await planUsage(user.id) });
}
