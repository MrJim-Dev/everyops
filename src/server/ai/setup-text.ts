/**
 * The interview may name the community system it built on by id ("built on our canteen-pos system"). Owners know
 * those systems by name, so ids are swapped for names before a reply is shown.
 */
export function withSystemNames(text: string, systems: { id: string; name: string }[]): string {
  let out = text;
  for (const s of systems) {
    const id = s.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${id}\\b`, "gi"), s.name);
  }
  return out;
}

/** A reply that announces questions ("I have 3 quick questions:") but stops before asking them. */
export function questionsMissing(message: string): boolean {
  return /:\s*$/.test(message.trim()) && !/\?/.test(message);
}
