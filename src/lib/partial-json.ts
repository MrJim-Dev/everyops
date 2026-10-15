/**
 * Reads the part of a JSON document that has arrived so far, while Gemini is still writing it. Everything up to the
 * last finished value is kept and the open objects and arrays are closed; a value still being written is left out,
 * so a name never shows half typed. Returns undefined until the first object or array opens.
 */
export function parsePartialJson(text: string): unknown {
  /** Closers for the open objects and arrays, innermost last. */
  const stack: string[] = [];
  let cut = -1;
  let closers = "";
  let inString = false;
  let escaped = false;
  const mark = (at: number) => {
    cut = at;
    closers = [...stack].reverse().join("");
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") {
      stack.push(c === "{" ? "}" : "]");
      mark(i + 1);
    } else if (c === "}" || c === "]") {
      stack.pop();
      mark(i + 1);
    } else if (c === ",") mark(i);
  }
  if (cut < 0) return undefined;
  try {
    return JSON.parse(text.slice(0, cut) + closers);
  } catch {
    return undefined;
  }
}

/**
 * The text of a string property while Gemini is still writing it, e.g. a reply's "message", so it can be shown as it
 * arrives. Returns undefined until the property starts, and `done` once its closing quote has arrived. Only for a key
 * that appears once in the answer.
 */
export function partialString(text: string, key: string): { value: string; done: boolean } | undefined {
  const start = new RegExp(`"${key}"\\s*:\\s*"`).exec(text);
  if (!start) return undefined;
  const from = start.index + start[0].length;
  let i = from;
  let done = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === '"') {
      done = true;
      break;
    }
  }
  // An escape cut off at the end (a lone backslash, half a \uXXXX) waits for the next part.
  const raw = text.slice(from, Math.min(i, text.length)).replace(/\\(u[0-9a-fA-F]{0,3})?$/, "");
  try {
    return { value: JSON.parse(`"${raw}"`) as string, done };
  } catch {
    return undefined;
  }
}
