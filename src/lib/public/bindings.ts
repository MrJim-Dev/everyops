/**
 * Data bindings for custom HTML pages. A page marks where data goes in plain HTML and the bridge fills it in from the
 * workspace's current results:
 *
 *   <ul><template data-everyops-each="menu_public"><li data-field="@title"></li></template></ul>
 *
 * The page around the frame answers EveryOps.items(source, block) with the source's rows as BoundItems, worked out
 * here, so the frame never needs to know the shape of a layout, landing or table result. Every value is text a
 * visitor may already read; nothing here reaches records the source didn't publish.
 */

import { publicHref } from "@/lib/domains";
import { looksLikeMoney } from "@/lib/format";
import type { Cell, PublicItem, ResolvedBlock } from "./resolve";

/** One row as the bindings read it: fields by id, by lower-case name and by role (@title, @price, @1 …). */
export type BoundItem = {
  id: string;
  fields: Record<string, string>;
  /** Label and value lines (duration, price, capacity), for <template data-everyops-each="@rows">. */
  rows: BoundItem[];
  /** Short labels (category, surface), for <template data-everyops-each="@tags">. */
  tags: BoundItem[];
};

export type BoundList =
  | { ok: true; items: BoundItem[]; total: number; truncated: boolean }
  | { ok: false; message: string };

/** What a page knows about the business and its site, for data-everyops-text="site.phone" and site.pages. */
export type SiteDetails = {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  hours?: string;
  /** The published pages, in menu order; the first is the home page. */
  pages: { id: string; name: string }[];
  /** The main booking or order page and its button label. */
  book?: { id: string; label: string };
};

/** "Duration Mins: 60" reads as "Duration: 60 min". */
export function withUnit(c: Cell): Cell {
  const unit = /\b(mins?|minutes|hrs?|hours)\b/i.exec(c.name)?.[1];
  if (!unit || !/^[\d.,]+$/.test(c.text)) return c;
  const short = /^h/i.test(unit) ? "hr" : "min";
  const name = c.name.replace(/[\s(]*\b(mins?|minutes|hrs?|hours)\b\)?/i, "").trim() || "Duration";
  return { ...c, name, text: `${c.text} ${short}` };
}

/** Markdown as the plain text a card shows. */
const plain = (text: string) =>
  text
    .replace(/[*_#>]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function line(name: string, text: string): BoundItem {
  return { id: name, fields: { "@name": name, "@text": text, name, text }, rows: [], tags: [] };
}

/** A row of cells with its roles: the first filled text is the title, the markdown its description, and so on. */
export function boundFromCells(id: string, cells: Cell[]): BoundItem {
  const fields: Record<string, string> = { "@id": id };
  cells.forEach((c, i) => {
    const text = c.kind === "markdown" ? plain(c.text) : c.text;
    fields[`@${i + 1}`] = text;
    if (!(c.fieldId in fields)) fields[c.fieldId] = text;
    const name = c.name.toLowerCase();
    if (!(name in fields)) fields[name] = text;
  });
  const filled = cells.filter((c) => c.text);
  const [title, ...rest] = filled.filter((c) => c.kind !== "image");
  const image = filled.find((c) => c.kind === "image");
  const about = rest.find((c) => c.kind === "markdown");
  const rows = rest.filter((c) => c.kind === "number" || c.kind === "text").map(withUnit);
  const tags = rest.filter((c) => c.kind === "tag" || c.kind === "status");
  const price = rows.find((c) => looksLikeMoney(c.text)) ?? rows[0];
  fields["@title"] = title?.text ?? "";
  fields["@image"] = image?.text ?? "";
  fields["@about"] = about ? plain(about.text) : "";
  fields["@price"] = price?.text ?? "";
  fields["@rows"] = rows.map((c) => c.text).join(", ");
  fields["@tags"] = tags.map((c) => c.text).join(", ");
  return {
    id,
    fields,
    rows: rows.map((c) => line(c.name, c.text)),
    tags: tags.map((c) => line(c.name, c.text)),
  };
}

/** A list item a public layout worked out (title, description, badge, image), as a bound item. */
function boundFromObject(value: Record<string, unknown>, i: number): BoundItem {
  if (Array.isArray(value.cells))
    return boundFromCells(String(value.id ?? `row_${i + 1}`), value.cells as Cell[]);
  const fields: Record<string, string> = { "@id": String(value.id ?? `row_${i + 1}`) };
  for (const [k, v] of Object.entries(value))
    if (typeof v === "string" || typeof v === "number") fields[k] = String(v);
  fields["@title"] = fields.title ?? fields.label ?? fields.name ?? "";
  fields["@about"] = fields.description ?? fields.body ?? "";
  fields["@image"] = fields.image ?? "";
  fields["@badge"] = fields.badge ?? "";
  return { id: fields["@id"], fields, rows: [], tags: [] };
}

const list = (items: BoundItem[], total = items.length, truncated = false): BoundList => ({
  ok: true,
  items,
  total,
  truncated,
});

/** A landing page's block (or the page's own sections) as items. Records blocks are the usual source. */
function fromBlocks(blocks: ResolvedBlock[], block?: string): BoundList {
  const b = block ? blocks.find((x) => x.id === block) : blocks.find((x) => x.type === "records");
  if (!b)
    return {
      ok: false,
      message: block ? `This source has no part "${block}".` : "This source has no list.",
    };
  switch (b.type) {
    case "records":
      return list(b.items.map((item: PublicItem) => boundFromCells(item.id, item.cells)));
    case "hero":
      return list(
        (b.facts ?? []).map((f, i) => ({
          id: `fact_${i + 1}`,
          fields: {
            "@id": `fact_${i + 1}`,
            "@title": f.text,
            "@text": f.text,
            "@kind": f.kind,
            text: f.text,
            kind: f.kind,
          },
          rows: [],
          tags: [],
        })),
      );
    case "highlights":
    case "steps":
      return list(b.items.map((x, i) => boundFromObject({ id: `item_${i + 1}`, ...x }, i)));
    case "contact": {
      const fields: Record<string, string> = { "@id": "contact", "@title": b.title ?? "" };
      for (const k of ["phone", "email", "address", "hours"] as const) fields[k] = b[k] ?? "";
      return list([{ id: "contact", fields, rows: [], tags: [] }]);
    }
    default:
      return { ok: false, message: "That part of the page has no list." };
  }
}

type LayoutResult = {
  sections: { items: { id: string; component: string; data: Record<string, unknown> }[] }[];
};

/** A part of a public layout (by its id; the first part with a list otherwise) as items. */
function fromLayout(layout: LayoutResult, block?: string): BoundList {
  const parts = layout.sections.flatMap((s) =>
    s.items.flatMap((item) => [
      item,
      ...((item.data.tabs as { items: typeof s.items }[] | undefined) ?? []).flatMap((t) => t.items),
    ]),
  );
  const part = block
    ? parts.find((p) => p.id === block)
    : parts.find((p) => Array.isArray(p.data.items) && p.data.items.length);
  if (!part)
    return {
      ok: false,
      message: block ? `This layout has no part "${block}".` : "This layout has no list.",
    };
  const items = Array.isArray(part.data.items) ? (part.data.items as Record<string, unknown>[]) : [];
  const total = typeof part.data.total === "number" ? part.data.total : items.length;
  return list(items.map(boundFromObject), total, total > items.length);
}

/**
 * Any EveryOps.data result as a list: a table's rows, a landing page's records block, a layout's list part, or the
 * page's own sections. Failures pass through with their message.
 */
export function itemsOf(result: unknown, block?: string): BoundList {
  const r = result as {
    ok?: boolean;
    message?: string;
    type?: string;
    items?: PublicItem[];
    total?: number;
    truncated?: boolean;
    blocks?: ResolvedBlock[];
    layout?: LayoutResult;
  } | null;
  if (!r || r.ok !== true) return { ok: false, message: r?.message ?? "This source isn't available." };
  if (r.type === "table")
    return list(
      (r.items ?? []).map((item) => boundFromCells(item.id, item.cells)),
      r.total ?? r.items?.length ?? 0,
      !!r.truncated,
    );
  if (r.type === "landing") return fromBlocks(r.blocks ?? [], block || undefined);
  if (r.type === "layout" && r.layout) return fromLayout(r.layout, block || undefined);
  return { ok: false, message: "This source has no list." };
}

/** The site's pages as items for a shared menu: name, href (the page's address) and current ("true" on this page). */
export function sitePageItems(
  site: SiteDetails,
  slug: string,
  current?: string,
  customDomain = false,
): BoundList {
  return list(
    site.pages.map((p, i) => ({
      id: p.id,
      fields: {
        "@id": p.id,
        "@title": p.name,
        name: p.name,
        href: publicHref(slug, i === 0 ? undefined : p.id, customDomain),
        current: p.id === current ? "true" : "",
      },
      rows: [],
      tags: [],
    })),
  );
}

/** The site's details as the flat values data-everyops-text="site.…" reads. */
export function siteValues(site: SiteDetails, slug: string, customDomain = false): Record<string, string> {
  return {
    name: site.name,
    phone: site.phone ?? "",
    email: site.email ?? "",
    address: site.address ?? "",
    hours: site.hours ?? "",
    contact: site.phone || site.email || site.address || site.hours ? "yes" : "",
    home: publicHref(slug, undefined, customDomain),
    book: site.book ? publicHref(slug, site.book.id, customDomain) : "",
    bookLabel: site.book?.label ?? "",
  };
}

const INCLUDE = /<([a-z][a-z0-9-]*)\b[^>]*\bdata-everyops-include\s*=\s*["']([^"']+)["'][^>]*>\s*<\/\1>/gi;

/** The HTML pages a page includes with <div data-everyops-include="VIEW_ID"></div>. */
export function includedIds(html: string): string[] {
  return [...html.matchAll(INCLUDE)].map((m) => m[2]);
}

/** The data sources a page's bindings read (lists and single records), without nested @rows and site menus. */
export function boundSources(html: string): string[] {
  const ids = [...html.matchAll(/data-everyops-(?:each|record)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
  return [
    ...new Set(ids.filter((id) => !id.startsWith("@") && !id.startsWith("site.") && !id.includes("{"))),
  ];
}

/** What goes in an include: another page's styles and the inside of its body (or all of it, for a fragment). */
export function includeBody(html: string): string {
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
  const styles = [
    ...head.matchAll(/<(style)\b[^>]*>[\s\S]*?<\/style>|<link\b[^>]*rel=["']?stylesheet[^>]*>/gi),
  ]
    .map((m) => m[0])
    .join("");
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1];
  if (body !== undefined) return styles + body;
  return /<html[\s>]/i.test(html) ? styles : html;
}

/**
 * The page with each include replaced by the page it names, once (an included page's own includes stay empty).
 * Shared headers and footers live in one HTML page and every page that includes them changes with it.
 */
export function withIncludes(html: string, pageOf: (id: string) => string | undefined): string {
  return html.replace(INCLUDE, (whole, tag: string, id: string) => {
    const included = pageOf(id);
    if (included === undefined) return whole;
    return (
      "<" +
      tag +
      ' data-everyops-included="' +
      id.replace(/[^a-z0-9_-]/gi, "") +
      '">' +
      includeBody(included).replace(INCLUDE, "") +
      "</" +
      tag +
      ">"
    );
  });
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
const textOf = (html: string) =>
  decode(
    html
      .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  ).trim();

/**
 * What search engines and link previews get from a page that otherwise only draws in its frame: its title, its
 * description (its own meta tag, else its first paragraph), its share picture, and its headings and paragraphs.
 */
export function pageMeta(html: string): {
  title?: string;
  description?: string;
  image?: string;
  headings: string[];
  paragraphs: string[];
} {
  const meta = (name: string) =>
    new RegExp(`<meta\\b[^>]*(?:name|property)=["']${name}["'][^>]*>`, "i")
      .exec(html)?.[0]
      .match(/content=["']([^"']*)["']/i)?.[1];
  const body = html
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1>/gi, " ")
    // Loading, empty and error placeholders aren't what the page says.
    .replace(/<([a-z][a-z0-9]*)\b[^>]*data-everyops-state[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const all = (tag: string) =>
    [...body.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))]
      .map((m) => textOf(m[1]))
      .filter(Boolean);
  const title = textOf(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "") || undefined;
  const paragraphs = all("p").slice(0, 12);
  const description =
    decode(meta("description") ?? meta("og:description") ?? "") ||
    paragraphs.find((p) => p.length > 30) ||
    paragraphs[0];
  const image = decode(meta("og:image") ?? "") || undefined;
  return {
    title,
    description: description ? description.slice(0, 300) : undefined,
    image: image && /^(https?:\/\/|\/)/.test(image) ? image : undefined,
    headings: [...all("h1"), ...all("h2"), ...all("h3")].slice(0, 20),
    paragraphs,
  };
}

const attr = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/**
 * A ready-to-style bound list for the editor's Connect data menu: loading, empty and error states, and a card per
 * row with the source's fields (or the usual roles when its fields aren't known up front).
 */
export function listSnippet(source: string, fields: { id: string; name: string }[] = [], block = ""): string {
  const shown = fields.slice(0, 5);
  const lines = shown.length
    ? shown.map((f, i) =>
        i === 0
          ? `      <h3 data-field="${attr(f.id)}"></h3>`
          : '      <p data-everyops-if="' +
            attr(f.id) +
            '">' +
            attr(f.name) +
            ': <span data-field="' +
            attr(f.id) +
            '"></span></p>',
      )
    : [
        '      <img data-everyops-if="@image" data-src="{@image}" alt="">',
        '      <h3 data-field="@title"></h3>',
        '      <p data-everyops-if="@about" data-field="@about"></p>',
        '      <p data-everyops-if="@price" data-field="@price"></p>',
      ];
  return [
    '<section class="everyops-list">',
    '  <p data-everyops-state="loading">Loading…</p>',
    '  <p data-everyops-state="empty" hidden>Nothing here yet.</p>',
    '  <p data-everyops-state="error" hidden></p>',
    '  <template data-everyops-each="' +
      attr(source) +
      '"' +
      (block ? ` data-everyops-block="${attr(block)}"` : "") +
      ">",
    "    <article>",
    ...lines,
    "    </article>",
    "  </template>",
    "</section>",
  ].join("\n");
}

/** One record, the one in the page's address (/s/site/page/RECORD); lists link to it with {@id}. */
export function recordSnippet(
  source: string,
  pageId: string,
  fields: { id: string; name: string }[],
): string {
  const [first, ...rest] = fields.slice(0, 8);
  return [
    `<!-- Link here from a list: <a data-href="/s/__everyops_site__/${attr(pageId)}/{@id}">More</a> -->`,
    `<article data-everyops-record="${attr(source)}">`,
    '  <p data-everyops-state="loading">Loading…</p>',
    '  <p data-everyops-state="empty" hidden>We couldn\'t find that one.</p>',
    '  <p data-everyops-state="error" hidden></p>',
    `  <h1 data-field="${attr(first?.id ?? "@title")}"></h1>`,
    ...rest.map(
      (f) =>
        '  <p data-everyops-if="' +
        attr(f.id) +
        '">' +
        attr(f.name) +
        ': <span data-field="' +
        attr(f.id) +
        '"></span></p>',
    ),
    "</article>",
  ].join("\n");
}

/** The site's pages as a menu that follows the site: pages published later show up, this page is marked. */
export const MENU_SNIPPET = [
  '<nav class="site-menu" aria-label="Pages">',
  '  <template data-everyops-each="site.pages">',
  '    <a data-href="{href}" aria-current="{current}" data-field="name"></a>',
  "  </template>",
  "</nav>",
].join("\n");

/** How to reach the business, from the website's contact details. */
export const CONTACT_SNIPPET = [
  '<dl class="site-contact" data-everyops-if="site.contact">',
  '  <div data-everyops-if="site.phone"><dt>Phone</dt><dd><a data-everyops-bind data-href="tel:{site.phone}" data-everyops-text="site.phone"></a></dd></div>',
  '  <div data-everyops-if="site.email"><dt>Email</dt><dd><a data-everyops-bind data-href="mailto:{site.email}" data-everyops-text="site.email"></a></dd></div>',
  '  <div data-everyops-if="site.address"><dt>Address</dt><dd data-everyops-text="site.address"></dd></div>',
  '  <div data-everyops-if="site.hours"><dt>Hours</dt><dd data-everyops-text="site.hours"></dd></div>',
  "</dl>",
].join("\n");
