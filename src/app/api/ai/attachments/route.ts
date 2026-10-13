import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB } from "@/lib/assistant/attachments";
import { saveAttachment } from "@/server/ai/attachments";
import { takeAiToken } from "@/server/ai/rate-limit";
import { apiUser, sameOrigin } from "@/server/session-api";

/** Uploads one file for an AI request (setup, assistant, change requests). Returns the reference to send with it. */
export async function POST(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || !file.size)
    return Response.json({ ok: false, message: "Choose a file to attach." }, { status: 400 });
  if (file.size > MAX_ATTACHMENT_BYTES)
    return Response.json(
      { ok: false, message: `That file is over ${MAX_ATTACHMENT_MB} MB.` },
      { status: 413 },
    );
  if (!takeAiToken(`upload:${user.id}`, 60).ok)
    return Response.json(
      { ok: false, message: "That's a lot of files. Wait a few minutes." },
      { status: 429 },
    );
  const name = file instanceof File ? file.name : "file";
  const ref = await saveAttachment(user.id, new Uint8Array(await file.arrayBuffer()), name, file.type);
  if (!ref)
    return Response.json(
      {
        ok: false,
        message:
          "Attach an image, PDF, audio clip, Excel or Word file, or a text, CSV or JSON file. Save older .xls or .doc files as .xlsx or .docx first.",
      },
      { status: 415 },
    );
  return Response.json({ ok: true, attachment: ref });
}
