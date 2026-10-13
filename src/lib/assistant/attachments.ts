import { z } from "zod";

/**
 * Files a person attaches to an AI request (a photographed menu, a price list PDF, a CSV of members). They are
 * uploaded first and stored under the uploader's account; messages only carry these small references.
 */
export const ATTACHMENT_KINDS = ["image", "pdf", "audio", "video", "text"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_ID =
  /^[0-9a-f-]{36}\.(png|jpg|gif|webp|heic|pdf|mp3|wav|ogg|flac|m4a|mp4|webm|txt|csv|tsv|md|json)$/;

export const attachmentRef = z.object({
  id: z.string().regex(ATTACHMENT_ID),
  name: z.string().max(200),
  mime: z.string().max(100),
  kind: z.enum(ATTACHMENT_KINDS),
  size: z.number().int().nonnegative(),
});
export type AttachmentRef = z.infer<typeof attachmentRef>;

export const MAX_ATTACHMENT_BYTES = 10_000_000;
/** Attached files are deleted this long after upload (Cloud Storage lifecycle rule, infra/uploads-lifecycle.json). */
export const ATTACHMENT_RETENTION_DAYS = 90;
/** Files per message. */
export const MAX_ATTACHMENTS = 5;
/** What the file picker offers; the server checks the bytes again. */
export const ATTACHMENT_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,application/pdf,audio/*,video/mp4,video/webm,.txt,.csv,.tsv,.md,.json";

/** "menu.jpg, prices.pdf", for transcripts and labels. */
export function attachmentNames(refs: AttachmentRef[] | undefined) {
  return (refs ?? []).map((r) => r.name).join(", ");
}

/** Every file in a conversation, oldest first, without repeats. */
export function attachmentsIn(turns: { attachments?: AttachmentRef[] }[]): AttachmentRef[] {
  const seen = new Map<string, AttachmentRef>();
  for (const t of turns) for (const a of t.attachments ?? []) seen.set(a.id, a);
  return [...seen.values()];
}
