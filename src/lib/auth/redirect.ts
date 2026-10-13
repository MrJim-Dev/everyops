/** Only same-site paths are allowed as a post-auth destination (no open redirects). */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/^\/(sign-in|sign-up|forgot-password|reset-password)/.test(next)) return fallback;
  return next;
}
