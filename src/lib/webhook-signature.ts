import { createHmac, timingSafeEqual } from "node:crypto";

/** Signing webhook deliveries (server and tests only: it uses node:crypto). */

/**
 * The signature header: "t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the endpoint's secret>".
 * Receivers recompute it and reject old timestamps (5 minutes) to stop replays.
 */
export function signature(secret: string, body: string, at = Date.now()): string {
  const t = Math.floor(at / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/** Checks a signature header the way a receiver should. */
export function verifySignature(
  secret: string,
  body: string,
  header: string,
  now = Date.now(),
  toleranceSec = 300,
) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
