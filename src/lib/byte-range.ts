/** Largest body sent at once. Cloud Run rejects any response over 32 MiB that isn't streamed. */
export const MAX_RANGE_BYTES = 16 * 1024 * 1024;

/**
 * Reads a single `Range: bytes=…` header against a file of `size` bytes and returns the inclusive
 * byte range to send, capped at MAX_RANGE_BYTES (media players ask again for the rest).
 * Returns null when there is no usable range (send the whole file) and "unsatisfiable" for a 416.
 */
export function byteRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null | "unsatisfiable" {
  const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, from, to] = match;
  let start: number;
  let end: number;
  if (from === "") {
    if (to === "") return null;
    const suffix = Number(to);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(from);
    end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  }
  if (start >= size || end < start) return "unsatisfiable";
  return { start, end: Math.min(end, start + MAX_RANGE_BYTES - 1) };
}
