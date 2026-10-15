/**
 * The section library for the websites setup builds. A website is a list of sections (nav, hero, highlights, what's
 * offered, how it works, ways to pay, FAQs, contact, a closing call to action and the footer), and every section
 * comes in several styles. A site's design picks one style per section plus a theme; the AI (or the owner) chooses
 * among them, never writes markup of its own, so every combination renders, stays live and follows the same motion
 * rules (Emil Kowalski's: a strong ease-out, under 300 ms, transform and opacity only, presses scale to 0.97, hover
 * only where there is a pointer, reduced motion keeps fades without movement).
 *
 * Each style is a renderer (markup) and its CSS. Only the CSS of the styles a site uses goes into its page.
 */
import type { HeroFact } from "./hero-facts";
import type { ResolvedBlock } from "./resolve";

type Records = Extract<ResolvedBlock, { type: "records" }>;
type Hero = Extract<ResolvedBlock, { type: "hero" }>;
type Contact = Extract<ResolvedBlock, { type: "contact" }>;
type Steps = Extract<ResolvedBlock, { type: "highlights" | "steps" }>;
type Highlights = Steps;
type Item = Records["items"][number];
type Cell = Item["cells"][number];

export type SectionKind =
  | "nav"
  | "hero"
  | "highlights"
  | "offer"
  | "steps"
  | "payments"
  | "faq"
  | "contact"
  | "closing"
  | "footer"
  | "booking";

/** One style of a section: its id, a short name for the picker, and a sentence for the AI choosing it. */
export type SectionStyle = { id: string; label: string; about: string };

export const SECTION_STYLES: Record<SectionKind, SectionStyle[]> = {
  nav: [
    { id: "bar", label: "Bar", about: "a thin sticky bar: name left, links and the button right" },
    { id: "centered", label: "Centered name", about: "the name in the middle, links left, button right" },
    { id: "floating", label: "Floating pill", about: "a rounded bar floating over the page" },
    { id: "solid", label: "Solid color", about: "a bar in the brand color with white text" },
    { id: "minimal", label: "Minimal", about: "just the name and the button, no bar" },
  ],
  hero: [
    {
      id: "split",
      label: "Split with card",
      about: "headline left, a card of prices, hours and the button right",
    },
    { id: "centered", label: "Centered", about: "centered headline and buttons with facts as pills below" },
    { id: "banner", label: "Color banner", about: "a big block in the brand color with white text" },
    {
      id: "editorial",
      label: "Editorial",
      about: "a very large headline, then the intro beside a list of facts",
    },
    { id: "menu", label: "Price list", about: "headline left, prices as a menu list right" },
    { id: "stats", label: "Big numbers", about: "headline, then the key facts as big numbers in a row" },
    { id: "dark", label: "Dark", about: "a dark full-width hero with a light card of prices" },
    { id: "minimal", label: "Minimal", about: "a quiet, smaller headline with the facts in one line" },
  ],
  highlights: [
    { id: "numbered", label: "Numbered", about: "three columns with a small number and a rule above each" },
    { id: "cards", label: "Cards", about: "bordered cards with a colored top edge" },
    { id: "icons", label: "Check icons", about: "each point with a round check icon" },
    { id: "list", label: "List", about: "rows: title left, text right, with dividers" },
    { id: "spotlight", label: "Spotlight", about: "the first point large on color, the others beside it" },
    { id: "split", label: "Heading beside", about: "a heading left, the points listed right" },
  ],
  offer: [
    { id: "cards", label: "Cards", about: "a grid of cards with tags, prices and details" },
    { id: "menu", label: "Menu", about: "a two-column menu: name, dotted line, price" },
    { id: "table", label: "Price table", about: "a table with one row per item and its prices" },
    { id: "tiles", label: "Compact tiles", about: "small tiles with an initial and the price" },
    { id: "feature", label: "Featured first", about: "the first item large, the rest listed beside it" },
    { id: "rows", label: "Rows", about: "full-width rows with details and a Book link each" },
    {
      id: "gallery",
      label: "Gallery",
      about: "picture-first cards (a colored panel when there is no picture)",
    },
    { id: "pricing", label: "Pricing cards", about: "centered cards with a big price and a button each" },
  ],
  steps: [
    { id: "cards", label: "Cards", about: "three cards in a row with numbered circles" },
    { id: "timeline", label: "Timeline", about: "a vertical line with a dot per step" },
    { id: "numbers", label: "Big numbers", about: "large outlined numbers beside each step" },
    { id: "split", label: "Heading beside", about: "the heading and button left, the steps right" },
    { id: "inline", label: "Connected", about: "steps in a row joined by arrows" },
    { id: "panel", label: "Color panel", about: "one colored panel holding the steps as columns" },
  ],
  payments: [
    { id: "cards", label: "Cards", about: "tinted cards with instructions and account details" },
    { id: "list", label: "List", about: "one row per method with its details" },
    { id: "compact", label: "Compact", about: "small cards side by side, details in small type" },
    { id: "table", label: "Table", about: "a table of methods and account details" },
    { id: "split", label: "Heading beside", about: "a heading and note left, the methods right" },
  ],
  faq: [
    { id: "accordion", label: "Accordion", about: "questions that open one at a time" },
    { id: "columns", label: "Two columns", about: "the accordion in two columns" },
    { id: "open", label: "All open", about: "every answer shown, in two columns" },
    { id: "split", label: "Heading beside", about: "a heading left, the accordion right" },
    { id: "cards", label: "Cards", about: "each question and answer in its own card" },
  ],
  contact: [
    { id: "cards", label: "Cards", about: "one small card per detail" },
    { id: "band", label: "Dark band", about: "the details in one dark band" },
    { id: "split", label: "Heading beside", about: "a heading and the button left, details right" },
    { id: "inline", label: "One line", about: "the details in one row with dividers" },
    { id: "centered", label: "Centered", about: "the details centered under the heading" },
  ],
  closing: [
    { id: "dark", label: "Dark band", about: "a dark rounded band with the question and the button" },
    { id: "accent", label: "Color band", about: "the same in the brand color" },
    { id: "centered", label: "Centered", about: "a centered question and button, no background" },
    { id: "split", label: "With facts", about: "a tinted panel with the facts beside the button" },
    { id: "minimal", label: "Minimal", about: "one line of text with a link" },
  ],
  footer: [
    { id: "simple", label: "Simple", about: "name left, a note right" },
    { id: "centered", label: "Centered", about: "everything centered" },
    { id: "columns", label: "Columns", about: "name, contact details and links in columns" },
    { id: "dark", label: "Dark", about: "a dark footer with the button" },
    { id: "minimal", label: "Minimal", about: "one small line" },
  ],
  booking: [
    { id: "split", label: "Summary right", about: "the steps left, a sticky summary right" },
    { id: "summary-left", label: "Summary left", about: "the summary left, the steps right" },
    { id: "centered", label: "Single column", about: "one narrow column, the summary under the steps" },
    { id: "topbar", label: "Summary on top", about: "the summary as a bar above the steps" },
    {
      id: "intro-side",
      label: "Intro beside",
      about: "the heading and summary in a column beside the steps",
    },
    { id: "card", label: "One card", about: "everything in one large card on a tinted page" },
  ],
};

/** The style of each section a site uses, and its theme (a palette name; empty picks one from the business). */
export type SiteDesign = Record<SectionKind, string> & { theme?: string };

export const DEFAULT_DESIGN: SiteDesign = {
  nav: "bar",
  hero: "split",
  highlights: "numbered",
  offer: "cards",
  steps: "cards",
  payments: "cards",
  faq: "accordion",
  contact: "cards",
  closing: "dark",
  footer: "simple",
  booking: "split",
};

/** A design with every section set to a style that exists (unknown or missing ones fall back to the default). */
export function cleanDesign(design: Partial<Record<string, unknown>> | undefined): SiteDesign {
  const out = { ...DEFAULT_DESIGN };
  for (const kind of Object.keys(SECTION_STYLES) as SectionKind[]) {
    const id = design?.[kind];
    if (typeof id === "string" && SECTION_STYLES[kind].some((s) => s.id === id)) out[kind] = id;
  }
  if (typeof design?.theme === "string" && design.theme) out.theme = design.theme;
  return out;
}

/**
 * Reference sites: a full design per kind of business, two each, that the AI starts from and adapts. They're the
 * "with reference" part: tried combinations that suit the business, so a design is never a random mix.
 */
export const REFERENCES: { id: string; kind: string; label: string; design: SiteDesign }[] = [
  {
    id: "venue-club",
    kind: "court",
    label: "Sports club",
    design: {
      ...DEFAULT_DESIGN,
      theme: "court",
      nav: "bar",
      hero: "split",
      highlights: "numbered",
      offer: "pricing",
      steps: "inline",
      closing: "dark",
      footer: "columns",
      booking: "split",
    },
  },
  {
    id: "venue-arena",
    kind: "court",
    label: "Arena",
    design: {
      ...DEFAULT_DESIGN,
      theme: "court",
      nav: "solid",
      hero: "stats",
      highlights: "icons",
      offer: "rows",
      steps: "panel",
      payments: "list",
      contact: "band",
      closing: "accent",
      footer: "dark",
      booking: "topbar",
    },
  },
  {
    id: "salon-boutique",
    kind: "plum",
    label: "Boutique salon",
    design: {
      ...DEFAULT_DESIGN,
      theme: "plum",
      nav: "centered",
      hero: "menu",
      highlights: "list",
      offer: "menu",
      steps: "timeline",
      faq: "split",
      contact: "split",
      closing: "centered",
      footer: "centered",
      booking: "intro-side",
    },
  },
  {
    id: "salon-studio",
    kind: "plum",
    label: "Beauty studio",
    design: {
      ...DEFAULT_DESIGN,
      theme: "plum",
      nav: "floating",
      hero: "centered",
      highlights: "cards",
      offer: "feature",
      steps: "numbers",
      payments: "compact",
      closing: "split",
      footer: "simple",
      booking: "card",
    },
  },
  {
    id: "stay-resort",
    kind: "tide",
    label: "Resort",
    design: {
      ...DEFAULT_DESIGN,
      theme: "tide",
      nav: "floating",
      hero: "editorial",
      highlights: "spotlight",
      offer: "gallery",
      steps: "timeline",
      faq: "columns",
      contact: "centered",
      closing: "dark",
      footer: "columns",
      booking: "summary-left",
    },
  },
  {
    id: "stay-rentals",
    kind: "tide",
    label: "Vacation rentals",
    design: {
      ...DEFAULT_DESIGN,
      theme: "tide",
      nav: "bar",
      hero: "split",
      highlights: "icons",
      offer: "rows",
      steps: "cards",
      payments: "split",
      faq: "open",
      closing: "accent",
      booking: "split",
    },
  },
  {
    id: "cafe-menu",
    kind: "clay",
    label: "Café",
    design: {
      ...DEFAULT_DESIGN,
      theme: "clay",
      nav: "minimal",
      hero: "menu",
      highlights: "split",
      offer: "menu",
      steps: "numbers",
      payments: "list",
      contact: "inline",
      closing: "centered",
      footer: "centered",
      booking: "centered",
    },
  },
  {
    id: "cafe-bistro",
    kind: "clay",
    label: "Bistro",
    design: {
      ...DEFAULT_DESIGN,
      theme: "clay",
      nav: "centered",
      hero: "dark",
      highlights: "numbered",
      offer: "table",
      steps: "split",
      faq: "cards",
      contact: "band",
      closing: "minimal",
      footer: "dark",
      booking: "card",
    },
  },
  {
    id: "wellness-calm",
    kind: "sage",
    label: "Wellness",
    design: {
      ...DEFAULT_DESIGN,
      theme: "sage",
      nav: "minimal",
      hero: "minimal",
      highlights: "list",
      offer: "feature",
      steps: "timeline",
      faq: "open",
      contact: "centered",
      closing: "centered",
      footer: "minimal",
      booking: "centered",
    },
  },
  {
    id: "wellness-clinic",
    kind: "sage",
    label: "Clinic",
    design: {
      ...DEFAULT_DESIGN,
      theme: "sage",
      nav: "bar",
      hero: "centered",
      highlights: "cards",
      offer: "table",
      steps: "panel",
      payments: "table",
      faq: "split",
      contact: "split",
      footer: "columns",
      booking: "intro-side",
    },
  },
  {
    id: "shop-bold",
    kind: "ember",
    label: "Bold shop",
    design: {
      ...DEFAULT_DESIGN,
      theme: "ember",
      nav: "solid",
      hero: "banner",
      highlights: "spotlight",
      offer: "tiles",
      steps: "inline",
      payments: "compact",
      contact: "band",
      closing: "accent",
      footer: "dark",
      booking: "topbar",
    },
  },
  {
    id: "shop-workshop",
    kind: "ember",
    label: "Workshop",
    design: {
      ...DEFAULT_DESIGN,
      theme: "ember",
      nav: "bar",
      hero: "stats",
      highlights: "list",
      offer: "rows",
      steps: "numbers",
      contact: "inline",
      closing: "split",
      footer: "simple",
      booking: "split",
    },
  },
];

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);
const plain = (s: string) => s.replace(/[*_#>]/g, "").trim();
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map(plain)
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join("");

/** "Duration Mins: 60" reads as "Duration: 60 min". */
function withUnit(c: Cell): Cell {
  const unit = /\b(mins?|minutes|hrs?|hours)\b/i.exec(c.name)?.[1];
  if (!unit || !/^[\d.,]+$/.test(c.text)) return c;
  const name = c.name.replace(/[\s(]*\b(mins?|minutes|hrs?|hours)\b\)?/i, "").trim() || "Duration";
  return { ...c, name, text: `${c.text} ${/^h/i.test(unit) ? "hr" : "min"}` };
}

/** A card's parts: its title, picture, tags (category), the one description, and the rest as label and value rows. */
export function cardParts(item: Item) {
  const filled = item.cells.filter((c) => c.text);
  const [title, ...rest] = filled.filter((c) => c.kind !== "image");
  const rows = rest.filter((c) => c.kind === "number" || c.kind === "text").map(withUnit);
  return {
    title,
    image: filled.find((c) => c.kind === "image"),
    tags: rest.filter((c) => c.kind === "tag" || c.kind === "status"),
    about: rest.find((c) => c.kind === "markdown"),
    rows,
    price: rows.find((c) => /₱|php/i.test(c.text)),
  };
}

const dl = (rows: Cell[]) =>
  rows.length
    ? `<dl>${rows.map((c) => `<div><dt>${esc(c.name)}</dt><dd>${esc(c.text)}</dd></div>`).join("")}</dl>`
    : "";
const tags = (cells: Cell[]) =>
  cells.length ? `<p class="tags">${cells.map((t) => `<span>${esc(t.text)}</span>`).join("")}</p>` : "";
const about = (c: Cell | undefined, max = 220) =>
  c ? `<p class="about">${esc(plain(c.text).slice(0, max))}</p>` : "";
const h2 = (title: string | undefined) => (title ? `<h2 class="reveal">${esc(title)}</h2>` : "");

/** Everything a section's renderer may use. */
export type SiteParts = {
  name: string;
  hero?: Hero;
  offer?: Records;
  contact?: Contact;
  /** The main button (to the booking or order page), and a smaller one for bars. */
  cta: string;
  ctaSmall: string;
  /** Where the main button goes, for per-item Book links. */
  ctaHref?: string;
  /** The anchor links for the nav. */
  links: string;
};

const ICONS: Record<HeroFact["kind"], string> = {
  offer: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  hours: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  price:
    '<path d="M3.5 12.5 11 5h8v8l-7.5 7.5a1.4 1.4 0 0 1-2 0l-6-6a1.4 1.4 0 0 1 0-2Z"/><circle cx="15.5" cy="8.5" r="1.3"/>',
  pay: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18M7 15h3"/>',
};
const icon = (kind: HeroFact["kind"]) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[kind]}</svg>`;
const CHECK =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

/** The first few offers with a price, for heroes that show prices. */
function picks(p: SiteParts, n = 3) {
  return (p.offer?.items ?? []).slice(0, n).flatMap((item) => {
    const { title, price, rows } = cardParts(item);
    return title ? [{ title: title.text, price: (price ?? rows[0])?.text }] : [];
  });
}
/** The hero's facts, leaving out the count when the prices already list the offers. */
const factsOf = (p: SiteParts, withCount = false) =>
  (p.hero?.facts ?? []).filter((f) => withCount || f.kind !== "offer" || !p.offer?.items.length);

// ── Hero: the live part ("glance") is what each style shows of the data. ─────────────────────────────────────

/** The data part of a hero in this style: prices, facts, the button. Redrawn from live data on every view. */
export function heroGlance(style: string, p: SiteParts): string {
  const list = picks(p);
  const facts = factsOf(p);
  const more =
    (p.offer?.items.length ?? 0) > list.length
      ? `<a class="more" href="#offer">All ${p.offer?.items.length} →</a>`
      : "";
  const priceList = (cls = "picks") =>
    list.length
      ? `<ul class="${cls}">${list.map((x) => `<li><span>${esc(x.title)}</span>${x.price ? `<b>${esc(x.price)}</b>` : ""}</li>`).join("")}</ul>`
      : "";
  const factList = (cls = "facts") =>
    facts.length
      ? `<ul class="${cls}">${facts.map((f) => `<li>${icon(f.kind)}<span>${esc(f.text)}</span></li>`).join("")}</ul>`
      : "";
  switch (style) {
    case "centered":
    case "banner": {
      const all = factsOf(p, true);
      return all.length
        ? `<ul class="pills rise">${all.map((f) => `<li>${icon(f.kind)}${esc(f.text)}</li>`).join("")}</ul>`
        : "";
    }
    case "editorial":
      return facts.length || list.length
        ? `<div class="aside rise">${priceList()}${factList("facts plain")}</div>`
        : "";
    case "menu":
      return list.length
        ? `<div class="menu-list rise"><p class="label">${esc(p.offer?.title ?? "Prices")}</p>${priceList("leaders")}${more}</div>`
        : factList("facts plain rise");
    case "stats": {
      const all = factsOf(p, true).slice(0, 4);
      return all.length
        ? `<dl class="stats rise">${all
            .map((f) => {
              const [big, ...rest] = f.text.replace(/^(From|Open|Pay with) /, "$1|").split("|");
              const value = rest.length ? rest.join(" ") : big;
              const label = rest.length ? big : f.kind === "offer" ? "to choose from" : "";
              return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
            })
            .join("")}</dl>`
        : "";
    }
    case "minimal": {
      const all = factsOf(p, true);
      return all.length ? `<p class="factline rise">${all.map((f) => esc(f.text)).join(" · ")}</p>` : "";
    }
    default:
      // split and dark: a card of prices, facts and the button.
      if (!facts.length && !list.length) return "";
      return `<aside class="glance rise" aria-label="At a glance">
    ${list.length ? `<p class="label">${esc(p.offer?.title ?? "What we offer")}</p>${priceList()}${more}` : ""}
    ${factList()}
    ${p.cta}
  </aside>`;
  }
}

/** The hero; glance and eyebrow are its live data parts, already wrapped for refreshing. */
/** The line above a hero's headline: opening hours, or how much there is to book. Live like the glance. */
export function heroNote(p: SiteParts): string {
  const note =
    p.hero?.facts?.find((f) => f.kind === "hours") ?? p.hero?.facts?.find((f) => f.kind === "offer");
  return note ? `<span class="eyebrow rise">${esc(note.text)}</span>` : "";
}

export function renderHero(style: string, p: SiteParts, glance: string, eyebrow = heroNote(p)): string {
  const h = p.hero;
  const lead = h?.subheading ? `<p class="lead rise">${esc(h.subheading)}</p>` : "";
  const secondary = p.offer
    ? `<a class="button" href="#offer">${esc(h?.secondaryLabel ?? "See what we offer")}</a>`
    : "";
  const actions = `<div class="actions rise">${p.cta}${secondary}</div>`;
  const title = `<h1 class="rise">${esc(h?.heading ?? p.name)}</h1>`;
  switch (style) {
    case "centered":
      return `<header class="hero hero-centered"><div class="wrap">${eyebrow}${title}${lead}${actions}${glance}</div></header>`;
    case "banner":
      return `<header class="hero hero-banner"><div class="wrap"><div class="band">${eyebrow}${title}${lead}${actions}${glance}</div></div></header>`;
    case "editorial":
      return `<header class="hero hero-editorial"><div class="wrap">${eyebrow}${title}<div class="cols"><div>${lead}${actions}</div>${glance}</div></div></header>`;
    case "stats":
      return `<header class="hero hero-stats"><div class="wrap">${eyebrow}${title}${lead}${actions}${glance}</div></header>`;
    case "minimal":
      return `<header class="hero hero-minimal"><div class="wrap">${title}${lead}${glance}${actions}</div></header>`;
    default: {
      // split, menu and dark: the words left, the data right.
      const cls = style === "menu" ? "hero-menu" : style === "dark" ? "hero-dark" : "hero-split";
      return `<header class="hero ${cls}"><div class="wrap grid2${glance.includes("<!--everyops:live glance--><!--") ? " solo" : ""}"><div>${eyebrow}${title}${lead}${actions}</div>${glance}</div></header>`;
    }
  }
}

// ── Nav and footer ─────────────────────────────────────────────────────────────────────────────────────────────

export function renderNav(style: string, p: SiteParts): string {
  const initial = esc(p.name.trim().charAt(0).toUpperCase() || "•");
  const brand = `<a class="brand" href="#top"><i aria-hidden="true">${initial}</i><strong>${esc(p.name)}</strong></a>`;
  switch (style) {
    case "centered":
      return `<nav class="nav-centered"><div class="wrap"><div class="links">${p.links}</div>${brand}<div class="end">${p.ctaSmall}</div></div></nav>`;
    case "floating":
      return `<nav class="nav-floating"><div class="wrap"><div class="pill">${brand}<div class="links">${p.links}${p.ctaSmall}</div></div></div></nav>`;
    case "solid":
      return `<nav class="nav-solid"><div class="wrap">${brand}<div class="links">${p.links}${p.ctaSmall}</div></div></nav>`;
    case "minimal":
      return `<nav class="nav-minimal"><div class="wrap">${brand}${p.ctaSmall}</div></nav>`;
    default:
      return `<nav class="nav-bar"><div class="wrap">${brand}<div class="links">${p.links}${p.ctaSmall}</div></div></nav>`;
  }
}

export function renderFooter(style: string, p: SiteParts): string {
  const year = new Date().getFullYear();
  const name = esc(p.name);
  switch (style) {
    case "centered":
      return `<footer class="foot-centered"><div class="wrap"><strong>${name}</strong><span>© ${year} ${name} · Booking by EveryOps</span></div></footer>`;
    case "columns": {
      const c = p.contact;
      const rows = [c?.phone, c?.email, c?.address, c?.hours].filter((x): x is string => !!x);
      return `<footer class="foot-columns"><div class="wrap"><div><strong>${name}</strong><p>${esc(p.hero?.subheading?.split(/(?<=[.!?])\s/)[0] ?? "")}</p></div><div><p class="label">Visit</p>${rows.map((r) => `<p>${esc(r)}</p>`).join("") || "<p>Book online any time.</p>"}</div><div><p class="label">Pages</p>${p.links.replace(/<a /g, "<p><a ").replace(/<\/a>/g, "</a></p>")}</div></div><div class="wrap fine">© ${year} ${name} · Booking by EveryOps</div></footer>`;
    }
    case "dark":
      return `<footer class="foot-dark"><div class="wrap"><strong>${name}</strong>${p.ctaSmall}</div><div class="wrap fine">© ${year} ${name} · Booking by EveryOps</div></footer>`;
    case "minimal":
      return `<footer class="foot-minimal"><div class="wrap">© ${year} ${name}</div></footer>`;
    default:
      return `<footer class="foot-simple"><div class="wrap"><span>© ${year} ${name}</span><span>Booking by EveryOps</span></div></footer>`;
  }
}

// ── Words sections: highlights, steps, closing ────────────────────────────────────────────────────────────────

export function renderHighlights(style: string, b: Highlights, p: SiteParts): string {
  if (!b.items.length) return "";
  const items = b.items;
  const point = (i: Highlights["items"][number], n: number, extra = "") =>
    `<div class="point reveal${extra}">${style === "numbered" ? `<span class="mark">${String(n + 1).padStart(2, "0")}</span>` : style === "icons" ? `<span class="tick">${CHECK}</span>` : ""}<h3>${esc(i.title)}</h3><p>${esc(i.body)}</p></div>`;
  switch (style) {
    case "list":
      return `<section id="why" class="section hl-list">${h2(b.title)}<div class="rows">${items.map((i) => `<div class="row reveal"><h3>${esc(i.title)}</h3><p>${esc(i.body)}</p></div>`).join("")}</div></section>`;
    case "spotlight":
      return `<section id="why" class="section hl-spotlight">${h2(b.title)}<div class="spot">${items.map((i, n) => point(i, n, n === 0 ? " lead-point" : "")).join("")}</div></section>`;
    case "split":
      return `<section id="why" class="section hl-split"><div class="side"><h2 class="reveal">${esc(b.title ?? `Why ${p.name}`)}</h2></div><div class="rows">${items.map((i) => point(i, 0)).join("")}</div></section>`;
    default:
      return `<section id="why" class="section hl-${style}">${h2(b.title)}<div class="grid three">${items.map((i, n) => point(i, n)).join("")}</div></section>`;
  }
}

export function renderSteps(style: string, b: Steps, p: SiteParts): string {
  if (!b.items.length) return "";
  const title = b.title ?? "How it works";
  const again = p.cta ? `<div class="again reveal">${p.cta}</div>` : "";
  const li = (i: Steps["items"][number], n: number) =>
    `<li class="reveal"><span class="num">${n + 1}</span><div><h3>${esc(i.title)}</h3><p>${esc(i.body)}</p></div></li>`;
  const list = `<ol class="steps">${b.items.map(li).join("")}</ol>`;
  if (style === "split")
    return `<section id="how" class="section st-split"><div class="side"><h2 class="reveal">${esc(title)}</h2>${again}</div>${list}</section>`;
  if (style === "panel")
    return `<section id="how" class="section st-panel"><div class="panel-box">${h2(title)}${list}${again}</div></section>`;
  return `<section id="how" class="section st-${style}">${h2(title)}${list}${again}</section>`;
}

export function renderClosing(style: string, p: SiteParts): string {
  if (!p.cta) return "";
  const label = (p.hero?.ctaLabel ?? "Book now").toLowerCase().replace(/\s+now$/, "");
  const q = `Ready to ${esc(label)}?`;
  switch (style) {
    case "minimal":
      return `<div class="close-minimal reveal"><p>${q} <a href="${esc(p.ctaHref ?? "#")}" target="_top">${esc(p.hero?.ctaLabel ?? "Book now")} →</a></p></div>`;
    case "centered":
      return `<div class="close-centered reveal"><h2>${q}</h2><p>${esc(p.name)} confirms it and sends you the details.</p>${p.cta}</div>`;
    case "split": {
      const facts = (p.hero?.facts ?? []).slice(0, 3);
      return `<div class="close-split reveal"><div><h2>${q}</h2>${facts.length ? `<ul>${facts.map((f) => `<li>${icon(f.kind)}${esc(f.text)}</li>`).join("")}</ul>` : ""}</div>${p.cta}</div>`;
    }
    default:
      return `<div class="close-${style === "accent" ? "accent" : "dark"} reveal"><h2>${q}</h2>${p.cta}</div>`;
  }
}

// ── Data sections (live): what's offered, ways to pay, FAQs, contact ──────────────────────────────────────────

export function renderOffer(style: string, b: Records, p: SiteParts): string {
  const items = b.items.map(cardParts).filter((x) => x.title);
  if (!items.length) return "";
  const book = p.ctaHref
    ? `<a class="link" href="${esc(p.ctaHref)}" target="_top">${esc(p.hero?.ctaLabel ?? "Book")} →</a>`
    : "";
  const head = h2(b.title);
  const wrap = (cls: string, body: string) =>
    `<section id="${b.id}" class="section of-${cls}">${head}${body}</section>`;
  switch (style) {
    case "menu":
      return wrap(
        "menu",
        `<div class="menu">${items
          .map(
            (x) =>
              `<div class="dish reveal"><p class="line"><b>${esc(x.title.text)}</b><i aria-hidden="true"></i>${x.price ? `<b>${esc(x.price.text)}</b>` : ""}</p>${about(x.about, 140)}${
                x.rows.filter((r) => r !== x.price).length
                  ? `<p class="small">${x.rows
                      .filter((r) => r !== x.price)
                      .map((r) => esc(`${r.name} ${r.text}`))
                      .join(" · ")}</p>`
                  : ""
              }</div>`,
          )
          .join("")}</div>`,
      );
    case "table": {
      const cols = [...new Set(items.flatMap((x) => x.rows.map((r) => r.name)))].slice(0, 4);
      return wrap(
        "table",
        `<div class="table-wrap reveal"><table><thead><tr><th>${esc(b.columns[0]?.name ?? "Name")}</th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${items.map((x) => `<tr><td><b>${esc(x.title.text)}</b>${x.tags.length ? `<small>${esc(x.tags.map((t) => t.text).join(", "))}</small>` : ""}</td>${cols.map((c) => `<td>${esc(x.rows.find((r) => r.name === c)?.text ?? "–")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
      );
    }
    case "tiles":
      return wrap(
        "tiles",
        `<div class="tiles">${items.map((x) => `<div class="tile reveal"><span class="initial">${esc(x.title.text.charAt(0).toUpperCase())}</span><div><b>${esc(x.title.text)}</b>${x.price ? `<small>${esc(x.price.text)}</small>` : ""}</div></div>`).join("")}</div>`,
      );
    case "feature": {
      const [first, ...rest] = items;
      return wrap(
        "feature",
        `<div class="feature"><article class="card big reveal">${first.image ? `<img src="${esc(first.image.text)}" alt="" loading="lazy">` : ""}${tags(first.tags)}<h3>${esc(first.title.text)}</h3>${about(first.about, 300)}${dl(first.rows)}${book}</article><div class="others">${rest.map((x) => `<div class="other reveal"><div><b>${esc(x.title.text)}</b>${about(x.about, 90)}</div>${x.price ? `<span>${esc(x.price.text)}</span>` : ""}</div>`).join("")}</div></div>`,
      );
    }
    case "rows":
      return wrap(
        "rows",
        `<div class="rows">${items.map((x) => `<div class="row reveal"><div><h3>${esc(x.title.text)}</h3>${tags(x.tags)}${about(x.about, 160)}</div>${dl(x.rows)}${book}</div>`).join("")}</div>`,
      );
    case "gallery":
      return wrap(
        "gallery",
        `<div class="grid cards">${items.map((x) => `<article class="card shot reveal">${x.image ? `<img src="${esc(x.image.text)}" alt="" loading="lazy">` : `<div class="ph" aria-hidden="true">${esc(x.title.text.charAt(0).toUpperCase())}</div>`}<div class="body">${tags(x.tags)}<h3>${esc(x.title.text)}</h3>${x.price ? `<p class="price">${esc(x.price.text)}</p>` : ""}</div></article>`).join("")}</div>`,
      );
    case "pricing":
      return wrap(
        "pricing",
        `<div class="grid cards">${items.map((x, n) => `<article class="card plan reveal${n === 1 ? " pop" : ""}">${tags(x.tags)}<h3>${esc(x.title.text)}</h3>${x.price ? `<p class="big-price">${esc(x.price.text)}</p>` : ""}${dl(x.rows.filter((r) => r !== x.price))}${p.ctaHref ? `<a class="button${n === 1 ? " primary" : ""}" href="${esc(p.ctaHref)}" target="_top">${esc(p.hero?.ctaLabel ?? "Book")}</a>` : ""}</article>`).join("")}</div>`,
      );
    default:
      return wrap(
        "cards",
        `<div class="grid cards">${items.map((x) => `<article class="card reveal">${x.image ? `<img src="${esc(x.image.text)}" alt="" loading="lazy">` : ""}${tags(x.tags)}<h3>${esc(x.title.text)}</h3>${about(x.about)}${dl(x.rows)}</article>`).join("")}</div>`,
      );
  }
}

export function renderPayments(style: string, b: Records): string {
  const items = b.items.map(cardParts).filter((x) => x.title);
  if (!items.length) return "";
  const head = h2(b.title);
  const card = (x: (typeof items)[number], cls = "card") =>
    `<article class="${cls} reveal"><h3>${esc(x.title.text)}</h3>${x.about ? `<p class="about">${esc(plain(x.about.text))}</p>` : ""}${dl(x.rows)}</article>`;
  switch (style) {
    case "list":
      return `<section id="${b.id}" class="section pay pay-list">${head}<div class="rows">${items.map((x) => `<div class="row reveal"><div><h3>${esc(x.title.text)}</h3>${x.about ? `<p class="about">${esc(plain(x.about.text))}</p>` : ""}</div>${dl(x.rows)}</div>`).join("")}</div></section>`;
    case "compact":
      return `<section id="${b.id}" class="section pay pay-compact">${head}<div class="grid compact">${items.map((x) => card(x, "card small")).join("")}</div></section>`;
    case "table": {
      const cols = [...new Set(items.flatMap((x) => x.rows.map((r) => r.name)))].slice(0, 3);
      return `<section id="${b.id}" class="section pay pay-table">${head}<div class="table-wrap reveal"><table><thead><tr><th>Method</th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}<th>How</th></tr></thead><tbody>${items.map((x) => `<tr><td><b>${esc(x.title.text)}</b></td>${cols.map((c) => `<td>${esc(x.rows.find((r) => r.name === c)?.text ?? "–")}</td>`).join("")}<td>${esc(x.about ? plain(x.about.text) : "")}</td></tr>`).join("")}</tbody></table></div></section>`;
    }
    case "split":
      return `<section id="${b.id}" class="section pay pay-split"><div class="side"><h2 class="reveal">${esc(b.title ?? "Ways to pay")}</h2><p class="about reveal">Pay the way that suits you. Your booking is confirmed once payment is checked.</p></div><div class="stack">${items.map((x) => card(x)).join("")}</div></section>`;
    default:
      return `<section id="${b.id}" class="section pay pay-cards">${head}<div class="grid cards">${items.map((x) => card(x)).join("")}</div></section>`;
  }
}

export function renderFaq(style: string, b: Records): string {
  const qa = b.items.flatMap((i) => {
    const [q, a] = i.cells;
    return q?.text ? [{ q: q.text, a: a?.text ?? "" }] : [];
  });
  if (!qa.length) return "";
  const title = b.title ?? "Questions";
  const details = (x: (typeof qa)[number]) =>
    `<details class="reveal"><summary>${esc(x.q)}<span aria-hidden="true" class="plus"></span></summary><div class="answer">${paragraphs(x.a)}</div></details>`;
  switch (style) {
    case "columns":
      return `<section id="faq" class="section faq-columns">${h2(title)}<div class="faq two">${qa.map(details).join("")}</div></section>`;
    case "open":
      return `<section id="faq" class="section faq-open">${h2(title)}<div class="qa">${qa.map((x) => `<div class="reveal"><h3>${esc(x.q)}</h3><div class="answer">${paragraphs(x.a)}</div></div>`).join("")}</div></section>`;
    case "split":
      return `<section id="faq" class="section faq-split"><div class="side"><h2 class="reveal">${esc(title)}</h2></div><div class="faq">${qa.map(details).join("")}</div></section>`;
    case "cards":
      return `<section id="faq" class="section faq-cards">${h2(title)}<div class="grid cards">${qa.map((x) => `<article class="card reveal"><h3>${esc(x.q)}</h3><div class="answer">${paragraphs(x.a)}</div></article>`).join("")}</div></section>`;
    default:
      return `<section id="faq" class="section faq-accordion">${h2(title)}<div class="faq">${qa.map(details).join("")}</div></section>`;
  }
}

export function renderContact(style: string, b: Contact, p: SiteParts): string {
  const rows = [
    ["Phone", b.phone],
    ["Email", b.email],
    ["Address", b.address],
    ["Hours", b.hours],
  ].filter((r): r is [string, string] => !!r[1]);
  if (!rows.length) return "";
  const title = b.title ?? "Visit us";
  const list = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");
  switch (style) {
    case "band":
      return `<section id="contact" class="section ct-band"><div class="band reveal"><h2>${esc(title)}</h2><dl>${list}</dl></div></section>`;
    case "split":
      return `<section id="contact" class="section ct-split"><div class="side"><h2 class="reveal">${esc(title)}</h2>${p.cta ? `<div class="reveal">${p.cta}</div>` : ""}</div><dl class="reveal">${list}</dl></section>`;
    case "inline":
      return `<section id="contact" class="section ct-inline">${h2(title)}<dl class="reveal">${list}</dl></section>`;
    case "centered":
      return `<section id="contact" class="section ct-centered">${h2(title)}<dl class="reveal">${list}</dl></section>`;
    default:
      return `<section id="contact" class="section ct-cards">${h2(title)}<dl class="contact reveal">${list}</dl></section>`;
  }
}

/** The CSS of one section style (scoped by its class), so a page carries only the styles it uses. */
export const STYLE_CSS: Record<SectionKind, Record<string, string>> = {
  nav: {
    bar: `.nav-bar { position: sticky; top: 0; z-index: 3; backdrop-filter: saturate(1.4) blur(12px); background: color-mix(in oklab, var(--bg) 84%, transparent); border-bottom: 1px solid var(--line); }
  .nav-bar .wrap { display: flex; align-items: center; justify-content: space-between; gap: 16px; height: 64px; }`,
    centered: `.nav-centered { position: sticky; top: 0; z-index: 3; backdrop-filter: saturate(1.4) blur(12px); background: color-mix(in oklab, var(--bg) 86%, transparent); border-bottom: 1px solid var(--line); }
  .nav-centered .wrap { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px; height: 72px; }
  .nav-centered .brand { flex-direction: column; gap: 4px; } .nav-centered .brand i { display: none; } .nav-centered strong { font-size: 22px; }
  .nav-centered .end { display: flex; justify-content: flex-end; }`,
    floating: `.nav-floating { position: sticky; top: 12px; z-index: 3; padding: 0 0 4px; }
  .nav-floating .pill { display: flex; align-items: center; justify-content: space-between; gap: 16px; height: 60px; padding: 0 10px 0 14px; border-radius: 999px; background: color-mix(in oklab, var(--card) 90%, transparent); backdrop-filter: saturate(1.4) blur(12px); border: 1px solid var(--line); box-shadow: 0 12px 30px -20px rgb(0 0 0 / .35); }`,
    solid: `.nav-solid { position: sticky; top: 0; z-index: 3; background: var(--accent); color: #fff; }
  .nav-solid .wrap { display: flex; align-items: center; justify-content: space-between; gap: 16px; height: 64px; }
  .nav-solid .brand i { background: #fff; color: var(--accent); }
  .nav-solid .links a:not(.button) { color: rgb(255 255 255 / .82); }
  .nav-solid .button.primary { background: #fff; color: var(--accent); box-shadow: none; }`,
    minimal: `.nav-minimal .wrap { display: flex; align-items: center; justify-content: space-between; gap: 16px; height: 76px; }
  .nav-minimal .brand i { display: none; } .nav-minimal strong { font-size: 20px; }`,
  },
  hero: {
    split: `.hero-split { padding: 80px 0 72px; background: radial-gradient(1200px 420px at 85% -10%, var(--tint), transparent 70%); }`,
    centered: `.hero-centered { padding: 96px 0 80px; text-align: center; background: radial-gradient(900px 380px at 50% -10%, var(--tint), transparent 70%); }
  .hero-centered h1, .hero-centered .lead { margin-left: auto; margin-right: auto; }
  .hero-centered .actions, .hero-centered .pills { justify-content: center; }`,
    banner: `.hero-banner { padding: 24px 0 48px; }
  .hero-banner .band { background: var(--accent); color: #fff; border-radius: 32px; padding: clamp(36px, 7vw, 88px); }
  .hero-banner .lead { color: rgb(255 255 255 / .86); }
  .hero-banner .eyebrow { background: rgb(255 255 255 / .16); color: #fff; }
  .hero-banner .button.primary { background: #fff; color: var(--accent); box-shadow: none; }
  .hero-banner .button:not(.primary) { background: transparent; color: #fff; border-color: rgb(255 255 255 / .45); }
  .hero-banner .pills li { background: rgb(255 255 255 / .14); color: #fff; } .hero-banner .pills svg { color: #fff; }`,
    editorial: `.hero-editorial { padding: 72px 0 64px; }
  .hero-editorial h1 { font-size: clamp(48px, 9vw, 112px); max-width: 16ch; line-height: .98; }
  .hero-editorial .cols { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 48px; align-items: start; border-top: 1px solid var(--line); padding-top: 28px; }
  .hero-editorial .aside { display: grid; gap: 16px; }`,
    menu: `.hero-menu { padding: 80px 0 72px; }
  .hero-menu .menu-list { border-left: 1px solid var(--line); padding-left: 40px; }`,
    stats: `.hero-stats { padding: 88px 0 56px; }
  .hero-stats .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0; margin: 48px 0 0; border-top: 1px solid var(--line); }
  .hero-stats .stats div { padding: 20px 20px 0 0; }
  .hero-stats .stats dt { color: var(--soft); font-size: 13px; text-transform: uppercase; letter-spacing: .06em; min-height: 1.2em; }
  .hero-stats .stats dd { margin: 4px 0 0; font: var(--display-weight) clamp(26px, 3.4vw, 40px)/1.1 var(--display); letter-spacing: -0.02em; }`,
    dark: `.hero-dark { padding: 88px 0 80px; background: var(--ink); color: var(--bg); }
  .hero-dark .lead { color: color-mix(in oklab, var(--bg) 72%, transparent); }
  .hero-dark .eyebrow { background: color-mix(in oklab, var(--bg) 14%, transparent); color: var(--bg); }
  .hero-dark .button:not(.primary) { background: transparent; color: var(--bg); border-color: color-mix(in oklab, var(--bg) 30%, transparent); }
  .hero-dark .glance { color: var(--ink); }`,
    minimal: `.hero-minimal { padding: 72px 0 48px; }
  .hero-minimal h1 { font-size: clamp(34px, 5vw, 52px); max-width: 20ch; }
  .hero-minimal .factline { color: var(--soft); margin: -12px 0 28px; font-size: 15px; }`,
  },
  highlights: {
    numbered: `.hl-numbered { border-top: 0; padding-top: 8px; }
  .point .mark { display: block; font: 600 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--accent); margin-bottom: 14px; padding-top: 14px; border-top: 2px solid var(--accent); width: 40px; }`,
    cards: `.hl-cards .point { background: var(--card); border: 1px solid var(--line); border-top: 3px solid var(--accent); border-radius: var(--radius); padding: 22px; }`,
    icons: `.hl-icons { border-top: 0; padding-top: 8px; }
  .point .tick { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 999px; background: var(--tint); color: var(--accent); margin-bottom: 14px; }`,
    list: `.hl-list .row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr); gap: 24px; padding: 20px 0; border-top: 1px solid var(--line); }
  .hl-list .row h3 { margin: 0; font-size: 20px; } .hl-list .row p { margin: 0; color: var(--soft); }`,
    spotlight: `.hl-spotlight .spot { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 16px; }
  .hl-spotlight .point { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 22px; }
  .hl-spotlight .lead-point { grid-row: span 3; background: var(--accent); color: #fff; border: 0; padding: 36px; display: flex; flex-direction: column; justify-content: flex-end; min-height: 280px; }
  .hl-spotlight .lead-point h3 { font-size: clamp(24px, 3vw, 32px); } .hl-spotlight .lead-point p { color: rgb(255 255 255 / .85); font-size: 17px; }`,
    split: `.hl-split, .st-split, .pay-split, .faq-split, .ct-split { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.4fr); gap: 48px; align-items: start; }
  .hl-split .side, .st-split .side, .pay-split .side, .faq-split .side, .ct-split .side { position: sticky; top: 96px; }
  .hl-split .rows { display: grid; gap: 24px; }`,
  },
  offer: {
    cards: "",
    menu: `.of-menu .menu { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 8px 56px; }
  .dish { padding: 14px 0; border-bottom: 1px solid var(--line); }
  .dish .line { display: flex; align-items: baseline; gap: 10px; margin: 0; font-size: 17px; }
  .dish .line i { flex: 1; border-bottom: 2px dotted color-mix(in oklab, var(--ink) 25%, transparent); transform: translateY(-4px); }
  .dish .about { margin: 4px 0 0; color: var(--soft); font-size: 14.5px; } .dish .small { margin: 4px 0 0; color: var(--soft); font-size: 13px; }`,
    table: `.of-table .table-wrap, .pay-table .table-wrap { overflow-x: auto; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); }
  table { width: 100%; border-collapse: collapse; font-size: 15px; }
  th { text-align: left; font-size: 12.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--soft); font-weight: 600; padding: 14px 18px; border-bottom: 1px solid var(--line); background: var(--tint); }
  td { padding: 16px 18px; border-bottom: 1px solid var(--line); vertical-align: top; } tr:last-child td { border-bottom: 0; }
  td small { display: block; color: var(--soft); font-size: 13px; }`,
    tiles: `.of-tiles .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
  .tile { display: flex; gap: 12px; align-items: center; padding: 14px; border-radius: 14px; background: var(--card); border: 1px solid var(--line); }
  .tile .initial { flex: none; display: grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; background: var(--tint); color: var(--accent); font: 700 18px/1 var(--display); }
  .tile small { display: block; color: var(--soft); font-size: 13.5px; }`,
    feature: `.of-feature .feature { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 20px; align-items: start; }
  .of-feature .big { padding: 32px; } .of-feature .big h3 { font-size: 28px; }
  .of-feature .big .link { margin-top: 18px; }
  .of-feature .others { display: grid; gap: 4px; }
  .of-feature .other { display: flex; justify-content: space-between; gap: 16px; padding: 16px 4px; border-bottom: 1px solid var(--line); }
  .of-feature .other .about { margin: 2px 0 0; font-size: 14px; color: var(--soft); } .of-feature .other span { font-weight: 600; white-space: nowrap; }`,
    rows: `.of-rows .rows { display: grid; gap: 12px; }
  .of-rows .row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto; gap: 24px; align-items: center; padding: 20px 24px; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); }
  .of-rows .row h3 { margin: 0 0 4px; } .of-rows .row .about { margin: 4px 0 0; color: var(--soft); font-size: 14.5px; }
  .of-rows .row dl { margin: 0; padding: 0; } .of-rows .row dl div:first-child { border-top: 0; }`,
    gallery: `.of-gallery .shot { padding: 0; overflow: hidden; }
  .of-gallery .shot img, .of-gallery .ph { width: 100%; margin: 0; aspect-ratio: 4 / 3; border-radius: 0; }
  .of-gallery .ph { display: grid; place-items: center; background: linear-gradient(135deg, var(--tint), color-mix(in oklab, var(--accent) 28%, var(--tint))); color: var(--accent); font: 700 64px/1 var(--display); }
  .of-gallery .body { padding: 18px 20px 20px; } .of-gallery .price { margin: 0; font-weight: 600; color: var(--accent); }`,
    pricing: `.of-pricing .plan { text-align: center; align-items: center; padding: 28px 24px; }
  .of-pricing .plan .tags { justify-content: center; }
  .of-pricing .big-price { font: var(--display-weight) 40px/1.1 var(--display); letter-spacing: -0.02em; margin: 6px 0 4px; }
  .of-pricing .plan dl { width: 100%; text-align: left; margin-bottom: 18px; } .of-pricing .plan .button { width: 100%; }
  .of-pricing .pop { border: 2px solid var(--accent); box-shadow: 0 24px 50px -32px var(--accent); }`,
  },
  steps: {
    cards: `.st-cards .steps, .st-panel .steps { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .st-cards .steps li { flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 22px; }`,
    timeline: `.st-timeline .steps { gap: 0; max-width: 720px; }
  .st-timeline .steps li { position: relative; padding: 0 0 32px 52px; }
  .st-timeline .steps li::before { content: ""; position: absolute; left: 16px; top: 34px; bottom: 0; width: 2px; background: var(--line); }
  .st-timeline .steps li:last-child::before { display: none; }
  .st-timeline .num { position: absolute; left: 0; top: 0; }`,
    numbers: `.st-numbers .steps { gap: 28px; }
  .st-numbers .steps li { display: grid; grid-template-columns: 96px 1fr; gap: 20px; align-items: start; padding-bottom: 28px; border-bottom: 1px solid var(--line); }
  .st-numbers .num { width: auto; height: auto; background: none; color: transparent; -webkit-text-stroke: 1.5px var(--accent); font: 800 72px/0.9 var(--display); border-radius: 0; }`,
    split: `.st-split .steps { display: grid; gap: 14px; }
  .st-split .steps li { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 20px; }
  .st-split .again { margin-top: 20px; }`,
    inline: `.st-inline .steps { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 40px; }
  .st-inline .steps li { flex-direction: column; position: relative; }
  .st-inline .steps li:not(:last-child)::after { content: "→"; position: absolute; right: -30px; top: 4px; color: var(--accent); font-size: 22px; }`,
    panel: `.st-panel .panel-box { background: var(--tint); border-radius: 28px; padding: clamp(28px, 5vw, 56px); }
  .st-panel .steps li { flex-direction: column; }
  .st-panel .num { background: var(--card); color: var(--accent); }`,
  },
  payments: {
    cards: `.pay-cards .card, .pay-split .card, .pay-compact .card { background: var(--tint); border-color: transparent; }
  .pay .grid.cards { align-items: start; }`,
    list: `.pay-list .rows { display: grid; }
  .pay-list .row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; padding: 20px 0; border-top: 1px solid var(--line); }
  .pay-list .row h3 { margin: 0 0 4px; } .pay-list .row dl { margin: 0; padding: 0; }`,
    compact: `.pay-compact .compact { grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); align-items: start; }
  .pay-compact .card { padding: 16px; } .pay-compact h3 { font-size: 16px; }
  .pay-compact .about, .pay-compact dl { font-size: 13px; }`,
    table: "",
    split: `.pay-split .stack { display: grid; gap: 12px; }
  .pay-split .side .about { color: var(--soft); }`,
  },
  faq: {
    accordion: "",
    columns: `.faq.two { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: none; align-items: start; }`,
    open: `.faq-open .qa { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 28px 48px; }
  .faq-open h3 { margin: 0 0 6px; font-size: 18px; } .faq-open .answer { padding: 0; }`,
    split: "",
    cards: `.faq-cards .answer { padding: 0; }`,
  },
  contact: {
    cards: `.ct-cards .contact div { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; }`,
    band: `.ct-band { border-top: 0; }
  .ct-band .band { background: var(--ink); color: var(--bg); border-radius: 28px; padding: clamp(28px, 5vw, 48px); }
  .ct-band h2 { margin: 0 0 24px; } .ct-band dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; margin: 0; }
  .ct-band dt { color: color-mix(in oklab, var(--bg) 65%, transparent); }`,
    split: `.ct-split dl { display: grid; gap: 0; margin: 0; } .ct-split dl div { padding: 16px 0; border-bottom: 1px solid var(--line); }
  .ct-split .side .button { margin-top: 8px; }`,
    inline: `.ct-inline dl { display: flex; flex-wrap: wrap; margin: 0; }
  .ct-inline dl div { padding: 4px 28px 4px 0; margin-right: 28px; border-right: 1px solid var(--line); } .ct-inline dl div:last-child { border-right: 0; }`,
    centered: `.ct-centered { text-align: center; } .ct-centered h2 { margin-left: auto; margin-right: auto; }
  .ct-centered dl { display: flex; flex-wrap: wrap; justify-content: center; gap: 16px 48px; margin: 0; }`,
  },
  closing: {
    dark: `.close-dark, .close-accent { margin: 0 0 72px; padding: 48px; border-radius: 28px; background: var(--ink); color: var(--bg); display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-wrap: wrap; }
  .close-dark h2, .close-accent h2 { margin: 0; font-size: clamp(26px, 3.4vw, 38px); letter-spacing: -0.02em; line-height: 1.1; max-width: 18ch; }`,
    accent: `.close-dark, .close-accent { margin: 0 0 72px; padding: 48px; border-radius: 28px; color: #fff; display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-wrap: wrap; }
  .close-accent { background: var(--accent); }
  .close-accent h2 { margin: 0; font-size: clamp(26px, 3.4vw, 38px); letter-spacing: -0.02em; line-height: 1.1; max-width: 18ch; }
  .close-accent .button.primary { background: #fff; color: var(--accent); box-shadow: none; }`,
    centered: `.close-centered { text-align: center; padding: 80px 0; border-top: 1px solid var(--line); }
  .close-centered h2 { margin: 0 auto 10px; font-size: clamp(30px, 4.4vw, 48px); letter-spacing: -0.02em; max-width: 18ch; }
  .close-centered p { color: var(--soft); margin: 0 0 24px; }`,
    split: `.close-split { margin: 0 0 72px; padding: 40px; border-radius: 28px; background: var(--tint); display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-wrap: wrap; }
  .close-split h2 { margin: 0 0 12px; font-size: clamp(26px, 3.4vw, 36px); letter-spacing: -0.02em; }
  .close-split ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 20px; color: var(--soft); font-size: 14.5px; }
  .close-split li { display: flex; gap: 8px; align-items: center; } .close-split svg { color: var(--accent); }`,
    minimal: `.close-minimal { padding: 56px 0; border-top: 1px solid var(--line); font-size: clamp(20px, 2.4vw, 26px); }
  .close-minimal p { margin: 0; } .close-minimal a { color: var(--accent); text-decoration: none; font-weight: 600; }`,
  },
  footer: {
    simple: `.foot-simple { padding: 32px 0 48px; color: var(--soft); font-size: 14px; border-top: 1px solid var(--line); }
  .foot-simple .wrap { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }`,
    centered: `.foot-centered { padding: 48px 0 56px; border-top: 1px solid var(--line); text-align: center; color: var(--soft); font-size: 14px; }
  .foot-centered .wrap { display: grid; gap: 8px; justify-items: center; } .foot-centered strong { color: var(--ink); font: var(--display-weight) 20px/1.2 var(--display); }`,
    columns: `.foot-columns { padding: 56px 0 32px; border-top: 1px solid var(--line); font-size: 14.5px; color: var(--soft); }
  .foot-columns .wrap:first-child { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr); gap: 32px; }
  .foot-columns strong { color: var(--ink); font: var(--display-weight) 20px/1.2 var(--display); } .foot-columns p { margin: 6px 0; }
  .foot-columns a { text-decoration: none; } .foot-columns .fine { margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--line); font-size: 13px; }`,
    dark: `.foot-dark { background: var(--ink); color: var(--bg); padding: 48px 0 32px; }
  .foot-dark .wrap:first-child { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
  .foot-dark strong { font: var(--display-weight) 24px/1.2 var(--display); }
  .foot-dark .fine { margin-top: 28px; font-size: 13px; color: color-mix(in oklab, var(--bg) 60%, transparent); }`,
    minimal: `.foot-minimal { padding: 28px 0 40px; text-align: center; color: var(--soft); font-size: 13px; }`,
  },
  booking: { split: "", "summary-left": "", centered: "", topbar: "", "intro-side": "", card: "" },
};

/** The CSS for a design's styles, plus rules the phone layout needs for them. */
export function designCss(design: SiteDesign): string {
  const kinds = Object.keys(STYLE_CSS) as SectionKind[];
  const css = new Set<string>();
  for (const kind of kinds) {
    const own = STYLE_CSS[kind][design[kind]];
    if (own) css.add(own);
    // Styles that share rules with another one (split sections, table, closing bands) bring them along.
    if (design[kind] === "split" && kind !== "hero" && kind !== "booking")
      css.add(STYLE_CSS.highlights.split);
    if (kind === "payments" && design.payments === "table") css.add(STYLE_CSS.offer.table);
    if (kind === "payments" && ["split", "compact"].includes(design.payments))
      css.add(STYLE_CSS.payments.cards);
    if (kind === "steps" && design.steps === "panel") css.add(STYLE_CSS.steps.cards);
  }
  return [...css].join("\n  ");
}
