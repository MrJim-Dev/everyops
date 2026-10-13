import { readAttachment } from "@/server/ai/attachments";
import { apiUser } from "@/server/session-api";

/** Shows a person their own attachment (thumbnails in the chat). Only the account that uploaded it can open it. */
export async function GET(request: Request, { params }: RouteContext<"/api/ai/attachments/[id]">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const file = await readAttachment(user.id, (await params).id);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.mime,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
      ...(file.kind === "image" ? {} : { "content-disposition": "attachment" }),
    },
  });
}
