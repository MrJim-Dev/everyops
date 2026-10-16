import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Seals secrets kept in the database (outside connections' OAuth tokens) with AES-256-GCM. The key comes from
 * CONNECTIONS_KEY (32+ random bytes, base64) or, failing that, is derived from BETTER_AUTH_SECRET, so a database dump
 * alone can't use them. Sealed values look like "v1.<iv>.<tag>.<ciphertext>" (base64url).
 */

const key = () => {
  const raw = process.env.CONNECTIONS_KEY || process.env.BETTER_AUTH_SECRET;
  if (!raw) throw new Error("CONNECTIONS_KEY or BETTER_AUTH_SECRET must be set to store connection tokens.");
  return Buffer.from(hkdfSync("sha256", raw, "everyops", "outside-connections-v1", 32));
};

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function unseal(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Not a sealed value.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
