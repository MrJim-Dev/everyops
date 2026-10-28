/**
 * Parts of a workspace page the person picked for the assistant ("this row", "that card"). Each one goes into the
 * next message as a short text reference, so the assistant knows exactly what "this" means.
 */

export type PickedElement = {
  id: string;
  /** What it is, e.g. "Table row", "Button", "Chart". */
  kind: string;
  /** What it's called or says, e.g. "Ana Reyes" or "New booking". */
  label: string;
  /** Where it sits on the page, e.g. "Bookings › All bookings". */
  path?: string;
  /** Its visible text, shortened. */
  text?: string;
  /** For parts of a custom HTML page: the element's markup, shortened. */
  html?: string;
};

export const MAX_PICKED = 3;
const LIMITS = { label: 80, path: 160, text: 300, html: 1200 };

export const clip = (value: string | undefined, max: number) => {
  const flat = (value ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** The same element picked twice is one pick. */
export const samePick = (a: PickedElement, b: PickedElement) =>
  a.kind === b.kind && a.label === b.label && a.path === b.path && a.html === b.html;

/** The note added to a message about what was picked. The server strips it from History entries. */
export function pickedNote(picked: Omit<PickedElement, "id">[], max = 2400): string {
  if (!picked.length) return "";
  const list = picked.slice(0, MAX_PICKED);
  // Markup is the longest part, so it shrinks first; the route takes 4,000 characters per message.
  const fixed = list.reduce(
    (n, p) =>
      n +
      60 +
      Math.min(p.label.length, LIMITS.label) +
      Math.min((p.path ?? "").length, LIMITS.path) +
      Math.min((p.text ?? "").length, LIMITS.text),
    30,
  );
  const withHtml = list.filter((p) => p.html).length || 1;
  const htmlRoom = Math.max(0, Math.min(LIMITS.html, Math.floor((max - fixed) / withHtml)));
  const textRoom =
    fixed > max ? Math.max(60, LIMITS.text - Math.ceil((fixed - max) / list.length)) : LIMITS.text;
  const lines = list.map((p, i) => {
    const head = `${i + 1}. ${clip(p.kind, 40)} "${clip(p.label, LIMITS.label)}"`;
    const where = p.path ? ` in ${clip(p.path, LIMITS.path)}` : "";
    const text =
      p.text && clip(p.text, textRoom) !== clip(p.label, LIMITS.label)
        ? `\n   Text: ${clip(p.text, textRoom)}`
        : "";
    const html = p.html && htmlRoom >= 40 ? `\n   HTML: ${clip(p.html, htmlRoom)}` : "";
    return head + where + text + html;
  });
  return `(Picked on the page:\n${lines.join("\n")})`;
}

/** A message's text without its picked note, as History and transcripts show it. */
export const withoutPickedNote = (text: string) =>
  text.replace(/\n*\(Picked on the page:\n[\s\S]*\)$/, "").trim();

const HEADING = "h1,h2,h3,h4,[data-slot=card-title],[role=heading]";
const KINDS: Record<string, string> = {
  a: "Link",
  button: "Button",
  h1: "Heading",
  h2: "Heading",
  h3: "Heading",
  h4: "Heading",
  h5: "Heading",
  h6: "Heading",
  tr: "Table row",
  td: "Table cell",
  th: "Column",
  table: "Table",
  thead: "Table header",
  img: "Image",
  input: "Field",
  select: "Field",
  textarea: "Field",
  li: "List item",
  ul: "List",
  ol: "List",
  form: "Form",
  nav: "Navigation",
  section: "Section",
  article: "Card",
  header: "Header",
  footer: "Footer",
  label: "Label",
  p: "Text",
  span: "Text",
  iframe: "Page",
  canvas: "Drawing",
  svg: "Icon",
};
const ROLES: Record<string, string> = {
  row: "Table row",
  cell: "Table cell",
  gridcell: "Table cell",
  columnheader: "Column",
  tab: "Tab",
  tablist: "Tabs",
  dialog: "Dialog",
  button: "Button",
  link: "Link",
  menuitem: "Menu item",
  region: "Section",
  listitem: "List item",
  checkbox: "Checkbox",
  switch: "Switch",
  combobox: "Field",
  textbox: "Field",
};

/** What a tag is called, for parts of a custom HTML page. */
export const kindOfTag = (tag: string) => KINDS[tag] ?? "Section";

const textOf = (el: Element) => clip((el as HTMLElement).innerText ?? el.textContent ?? "", 400);

function kindOf(el: Element): string {
  if (el.closest(".recharts-wrapper,[data-slot=chart]")) return "Chart";
  if (el.matches("[data-slot=card]")) return "Card";
  if (el.matches("[data-slot=badge]")) return "Badge";
  const role = el.getAttribute("role");
  if (role && ROLES[role]) return ROLES[role];
  return KINDS[el.tagName.toLowerCase()] ?? "Section";
}

function labelOf(el: Element): string {
  const aria = el.getAttribute("aria-label") || el.getAttribute("title");
  if (aria) return aria;
  // A row is named by its first cell with text (the record's name).
  if (el.matches("tr,[role=row]"))
    for (const cell of el.querySelectorAll("td,th,[role=cell],[role=gridcell]"))
      if (textOf(cell)) return textOf(cell);
  if (el instanceof HTMLImageElement) return el.alt || "Picture";
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  ) {
    const label = el.labels?.[0]?.textContent || el.getAttribute("placeholder") || el.name;
    return label || "Field";
  }
  const heading = el.matches(HEADING) ? el : el.querySelector(HEADING);
  const own = heading ? textOf(heading) : "";
  return own || textOf(el).split(/(?<=[.!?])\s/)[0] || el.tagName.toLowerCase();
}

/** Where an element sits: the named sections and card titles around it, outermost first. */
function pathOf(el: Element, root: Element): string {
  const names: string[] = [];
  for (let at = el.parentElement; at && at !== root && names.length < 4; at = at.parentElement) {
    const aria = at.getAttribute("aria-label");
    const heading = [...at.children].find(
      (c) => c.matches(HEADING) || c.querySelector(`:scope > ${HEADING}`),
    );
    const name = aria || (heading ? labelOf(heading) : "");
    if (name && !names.includes(clip(name, 60))) names.push(clip(name, 60));
  }
  const title = root.querySelector("h1");
  if (title && !names.includes(clip(textOf(title), 60))) names.push(clip(textOf(title), 60));
  return names.reverse().join(" › ");
}

/**
 * What to highlight under the pointer: small inline bits (an icon, a word in a badge) stand for the control or
 * line they're part of.
 */
export function pickTarget(el: Element, root: Element): Element | null {
  // Table rows and charts are picked whole: "this row" means the record, not one cell or word in it.
  const row = el.closest("td,th,[role=cell],[role=gridcell]")?.closest("tr,[role=row]");
  if (row && root.contains(row)) return row;
  const whole = el.closest(
    "button,a,input,select,textarea,[role=tab],[role=menuitem],tr,[role=row],.recharts-wrapper,[data-slot=chart],iframe",
  );
  if (whole && root.contains(whole) && whole !== root) return whole;
  let at: Element | null = el;
  while (at && at !== root) {
    if (
      at.matches(
        "button,a,input,select,textarea,tr,[role=row],[role=tab],[data-slot=badge],img,iframe,h1,h2,h3,h4",
      )
    )
      return at;
    const r = at.getBoundingClientRect();
    if (r.width * r.height >= 1600 && !(at instanceof SVGElement)) return at;
    at = at.parentElement;
  }
  return null;
}

export function describeElement(el: Element, root: Element): Omit<PickedElement, "id"> {
  const label = clip(labelOf(el), LIMITS.label);
  const text = textOf(el);
  return {
    kind: kindOf(el),
    label: label || "Element",
    ...(pathOf(el, root) ? { path: pathOf(el, root) } : {}),
    ...(text && text !== label ? { text: clip(text, LIMITS.text) } : {}),
  };
}
