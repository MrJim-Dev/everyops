"use client";

const MAX_BYTES = 5_000_000;

/**
 * Uploads a picture to the workspace's storage and returns its link. Previews (nothing is saved) keep the picture
 * in the browser instead. Throws a plain message people can read.
 */
export async function uploadImage(
  file: File,
  workspace: { mode: "live" | "preview"; id: string },
): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type))
    throw new Error("Choose a PNG, JPG, WebP or GIF image.");
  if (file.size > MAX_BYTES) throw new Error("That image is over 5 MB.");
  if (workspace.mode === "preview")
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Couldn't read that image."));
      reader.readAsDataURL(file);
    });
  const form = new FormData();
  form.set("file", file);
  form.set("workspaceId", workspace.id);
  const res = await fetch("/api/uploads", { method: "POST", body: form }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as {
    ok: boolean;
    url?: string;
    message?: string;
  } | null;
  if (!body?.ok || !body.url) throw new Error(body?.message ?? "Couldn't upload the image. Try again.");
  return body.url;
}
