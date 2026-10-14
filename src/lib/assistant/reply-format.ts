/**
 * Models sometimes write a numbered list inside one sentence ("…3 quick questions: 1. How many courts? 2. What is
 * your rate?"). That reads as a wall of text, so a run of inline "1. … 2. …" items is moved onto its own lines,
 * where the chat renders it as a list. Only a run that counts up from 1 is split, so "Court 2. Then…" stays put.
 */
export function splitInlineLists(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const run: number[] = [];
      for (const m of line.matchAll(/(^|\s)(\d{1,2})[.)]\s+(?=\S)/g)) {
        const at = (m.index ?? 0) + m[1].length;
        const n = Number(m[2]);
        if (n === run.length + 1) run.push(at);
        else if (n === 1 && run.length < 2) run.splice(0, run.length, at);
      }
      if (run.length < 2) return line;
      const lead = line.slice(0, run[0]).trimEnd();
      const items = run.map((at, i) => line.slice(at, run[i + 1]).trim());
      return [...(lead ? [lead, ""] : []), ...items].join("\n");
    })
    .join("\n");
}

export type ReplyBlock = { id: number; list?: "ul" | "ol"; lines: string[] };

/**
 * A reply as paragraphs and lists. Blank lines separate paragraphs; a run of "- " or "1. " lines becomes one list,
 * even with blank lines between its items, so spaced-out questions still number 1, 2, 3.
 */
export function replyBlocks(text: string): ReplyBlock[] {
  const blocks: ReplyBlock[] = [];
  for (const raw of splitInlineLists(text).split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+/.exec(line);
    const numbered = /^\d+[.)]\s+/.exec(line);
    const kind = bullet ? "ul" : numbered ? "ol" : undefined;
    const content = kind ? line.slice((bullet ?? numbered)?.[0].length) : line;
    const prev = blocks.at(-1);
    if (!line) {
      if (!prev?.list) blocks.push({ id: blocks.length, lines: [] });
    } else if (prev && prev.list === kind && (kind || prev.lines.length)) prev.lines.push(content);
    else blocks.push({ id: blocks.length, list: kind, lines: [content] });
  }
  return blocks.filter((b) => b.lines.length);
}
