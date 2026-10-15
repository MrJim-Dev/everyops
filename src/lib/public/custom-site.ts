/**
 * The custom HTML website setup builds for businesses whose customers book or order on their own. It's a real HTML
 * page the owner can open and edit (Edit HTML, or ask EveryOps), written from the same words and data as the standard
 * site: hero, highlights, what's offered, how it works, ways to pay, FAQs and contact. Its buttons open the public
 * booking form, so visitors still get the live slot picker.
 *
 * The design follows Emil Kowalski's design engineering rules: motion only where it explains or confirms, a strong
 * ease-out curve, everything under 300 ms, only transform and opacity animate, presses scale to 0.97, entrances start
 * at opacity 0 and 8 px down (never from scale 0) with a short stagger, hover effects only on devices that hover, and
 * reduced motion keeps the fades without the movement.
 */
import type {
  Blueprint,
  BookingLayout,
  DataRecord,
  FormView,
  HtmlPageView,
  LandingView,
} from "@/lib/blueprint/types";
import { withUnit } from "./bindings";
import { customBookingHtml } from "./booking-page";
import type { HeroFact } from "./hero-facts";
import { type PageDocs, type ResolvedBlock, resolveBlocks } from "./resolve";
import { bookLabel, defaultCopy, mainForm, offeringOf, standardBlocks } from "./site-template";

/** Stands in for the workspace slug in links the page is created with; filled in wherever the page is shown. */
export const SITE_TOKEN = "__everyops_site__";

/** The page's HTML with links to the workspace's own pages pointing at its real address. */
export function withSiteLinks(html: string, slug: string): string {
  return html.split(`/s/${SITE_TOKEN}`).join(`/s/${slug}`);
}

/**
 * A few looks with a heading font each, picked from what the business is (courts, salons, stays, food) or, failing
 * that, from its name, so two businesses' sites don't all look the same. Body text stays the system font, so the page
 * reads at once and the heading font (Google Fonts, display=swap) only refines it.
 */
const PALETTES = [
  {
    name: "court",
    bg: "#f5f7f1",
    ink: "#14201a",
    soft: "#57685d",
    accent: "#1f7a4d",
    tint: "#e1eee4",
    card: "#ffffff",
    font: "Bricolage Grotesque",
    weight: "700",
  },
  {
    name: "clay",
    bg: "#fbf6f0",
    ink: "#2a1d16",
    soft: "#7a6458",
    accent: "#b4532a",
    tint: "#f5e3d6",
    card: "#fffdfa",
    font: "Fraunces",
    weight: "600",
  },
  {
    name: "tide",
    bg: "#f2f6fa",
    ink: "#122030",
    soft: "#536477",
    accent: "#1d5fa8",
    tint: "#dde8f5",
    card: "#ffffff",
    font: "Manrope",
    weight: "800",
  },
  {
    name: "plum",
    bg: "#faf5f7",
    ink: "#24151f",
    soft: "#715b69",
    accent: "#9b3d73",
    tint: "#f3e0ea",
    card: "#ffffff",
    font: "DM Serif Display",
    weight: "400",
  },
  {
    name: "sage",
    bg: "#f4f5f0",
    ink: "#1d221b",
    soft: "#62695d",
    accent: "#56704a",
    tint: "#e3e9dc",
    card: "#fdfdfa",
    font: "Cormorant Garamond",
    weight: "700",
  },
  {
    name: "ember",
    bg: "#f7f5f2",
    ink: "#1b1a19",
    soft: "#69645d",
    accent: "#d1451f",
    tint: "#f6e1d8",
    card: "#ffffff",
    font: "Archivo",
    weight: "800",
  },
] as const;
export type SitePalette = (typeof PALETTES)[number];

const KINDS: [RegExp, SitePalette["name"]][] = [
  [
    /\b(salons?|hair|stylists?|barbers?|nails?|beauty|lash|brows?|makeup|bridal|boutique|florists?)(?![a-z])/i,
    "plum",
  ],
  [
    /\b(spas?|massage|wellness|yoga|pilates|skin|derma\w*|clinics?|dental|therapy|retreats?)(?![a-z])/i,
    "sage",
  ],
  [
    /\b(beach|resorts?|stays?|staycations?|villas?|hotels?|inns?|condos?|rooms?|island|dive|tours?|travel|boats?)(?![a-z])/i,
    "tide",
  ],
  [
    /\b(caf[eé]s?|kap[eé]|menus?|coffee|tea|milk tea|bakery|bakes?|restaurants?|kitchens?|food|grill|bar|catering|pastr\w*)(?![a-z])/i,
    "clay",
  ],
  [/\b(gyms?|fitness|crossfit|boxing|mma|auto|motors?|garage|repairs?|printing)(?![a-z])/i, "ember"],
  [/\b(courts?|pickleball|badminton|tennis|futsal|basketball|golf|sports?|padel|swim\w*)(?![a-z])/i, "court"],
];

/** The look for a business: by what it is (its name and what it offers), else by its name alone. */
export function paletteFor(name: string, about = ""): SitePalette {
  const kind = KINDS.find(([re]) => re.test(`${name} ${about}`))?.[1];
  const fit = kind && PALETTES.find((p) => p.name === kind);
  if (fit) return fit;
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

/** The <link> that loads a palette's heading font. */
export function fontLink(p: SitePalette): string {
  const family = p.font.replace(/ /g, "+");
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${family}:wght@${p.weight}&display=swap">`;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

/** Markdown answers (FAQs) as plain paragraphs; the page stays simple to edit. */
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.replace(/[*_#>]/g, "").trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join("");

type Records = Extract<ResolvedBlock, { type: "records" }>;
type Hero = Extract<ResolvedBlock, { type: "hero" }>;
type Item = Records["items"][number];

/** A card's parts: its title, picture, tags (category), the one description, and the rest as label and value rows. */
function cardParts(item: Item) {
  const filled = item.cells.filter((c) => c.text);
  const [title, ...rest] = filled.filter((c) => c.kind !== "image");
  return {
    title,
    image: filled.find((c) => c.kind === "image"),
    tags: rest.filter((c) => c.kind === "tag" || c.kind === "status"),
    about: rest.find((c) => c.kind === "markdown"),
    rows: rest.filter((c) => c.kind === "number" || c.kind === "text").map(withUnit),
  };
}

function offerCards(b: Records) {
  return b.items
    .map((item) => {
      const { title, image, tags, about, rows } = cardParts(item);
      if (!title) return "";
      const picture = image ? `<img src="${esc(image.text)}" alt="" loading="lazy">` : "";
      const tag = tags.length
        ? `<p class="tags">${tags.map((t) => `<span>${esc(t.text)}</span>`).join("")}</p>`
        : "";
      const text = about
        ? `<p class="about">${esc(about.text.replace(/[*_#>]/g, "").slice(0, 220))}</p>`
        : "";
      const details = rows.length
        ? `<dl>${rows.map((c) => `<div><dt>${esc(c.name)}</dt><dd>${esc(c.text)}</dd></div>`).join("")}</dl>`
        : "";
      return `<article class="card reveal">${picture}${tag}<h3>${esc(title.text)}</h3>${text}${details}</article>`;
    })
    .join("");
}

/** Ways to pay: the method's name, how to pay as a sentence, then the account details. Its type isn't repeated. */
function payCards(b: Records) {
  return b.items
    .map((item) => {
      const { title, about, rows } = cardParts(item);
      if (!title) return "";
      const text = about ? `<p class="about">${esc(about.text.replace(/[*_#>]/g, ""))}</p>` : "";
      const details = rows.length
        ? `<dl>${rows.map((c) => `<div><dt>${esc(c.name)}</dt><dd>${esc(c.text)}</dd></div>`).join("")}</dl>`
        : "";
      return `<article class="card reveal"><h3>${esc(title.text)}</h3>${text}${details}</article>`;
    })
    .join("");
}

const ICONS: Record<HeroFact["kind"], string> = {
  offer: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  hours: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  price:
    '<path d="M3.5 12.5 11 5h8v8l-7.5 7.5a1.4 1.4 0 0 1-2 0l-6-6a1.4 1.4 0 0 1 0-2Z"/><circle cx="15.5" cy="8.5" r="1.3"/>',
  pay: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18M7 15h3"/>',
};
const icon = (kind: HeroFact["kind"]) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[kind]}</svg>`;

/** The hero's right side: what a visitor wants to know before booking, a few of the offers with prices, and the button. */
function heroCard(hero: Hero | undefined, offer: Records | undefined, cta: string) {
  const facts = (hero?.facts ?? []).filter((f) => f.kind !== "offer" || !offer?.items.length);
  const picks = (offer?.items ?? []).slice(0, 3).flatMap((item) => {
    const { title, rows } = cardParts(item);
    if (!title) return [];
    const price = rows.find((c) => /₱|php/i.test(c.text)) ?? rows[0];
    return [`<li><span>${esc(title.text)}</span>${price ? `<b>${esc(price.text)}</b>` : ""}</li>`];
  });
  if (!facts.length && !picks.length) return "";
  const more =
    (offer?.items.length ?? 0) > picks.length
      ? `<a class="more" href="#offer">All ${offer?.items.length} →</a>`
      : "";
  return `<aside class="glance rise" aria-label="At a glance">
    ${picks.length ? `<p class="label">${esc(offer?.title ?? "What we offer")}</p><ul class="picks">${picks.join("")}</ul>${more}` : ""}
    ${facts.length ? `<ul class="facts">${facts.map((f) => `<li>${icon(f.kind)}<span>${esc(f.text)}</span></li>`).join("")}</ul>` : ""}
    ${cta}
  </aside>`;
}

function section(id: string, title: string | undefined, body: string, className = "") {
  if (!body) return "";
  const heading = title ? `<h2 class="reveal">${esc(title)}</h2>` : "";
  return `<section id="${id}" class="section ${className}">${heading}${body}</section>`;
}

/*
 * Setup's website draws its data parts with bindings (src/lib/public/bindings.ts): each is a <template> the bridge
 * fills from the page's own sections (EveryOps.data("page")) every time the page is shown. The markup inside a
 * template is the owner's to restyle; only the values change, so a redesigned card keeps its design and its data.
 */

/** A data section that hides itself while it has nothing to show, and shows records added later. */
function boundSection(id: string, title: string | undefined, body: string, className = "") {
  const heading = title ? `<h2 class="reveal">${esc(title)}</h2>` : "";
  return `<section id="${id}" class="section ${className}" data-everyops-hide-empty>${heading}${body}</section>`;
}

/** Cards of what's offered (with picture, tags and details) or of ways to pay. */
function boundCards(b: Records) {
  const pay = b.id === "payments";
  const card = pay
    ? `<article class="card reveal"><h3 data-field="@title"></h3><p class="about" data-everyops-if="@about" data-field="@about"></p>${ROWS}</article>`
    : `<article class="card reveal"><img data-everyops-if="@image" data-src="{@image}" alt="" loading="lazy"><p class="tags" data-everyops-if="@tags"><template data-everyops-each="@tags"><span data-field="@text"></span></template></p><h3 data-field="@title"></h3><p class="about clamp" data-everyops-if="@about" data-field="@about"></p>${ROWS}</article>`;
  return boundSection(
    b.id,
    b.title,
    `<div class="grid cards"><template data-everyops-each="page" data-everyops-block="${esc(b.id)}" data-everyops-skip="@title=">${card}</template></div>`,
    pay ? "pay" : "",
  );
}
const ROWS =
  '<dl data-everyops-if="@rows"><template data-everyops-each="@rows"><div><dt data-field="@name"></dt><dd data-field="@text"></dd></div></template></dl>';

/** Questions and answers, one disclosure each. */
function boundFaq(b: Records) {
  return boundSection(
    "faq",
    b.title ?? "Questions",
    `<div class="faq"><template data-everyops-each="page" data-everyops-block="${esc(b.id)}" data-everyops-skip="@1="><details class="reveal"><summary><span data-field="@1"></span><span aria-hidden="true" class="plus"></span></summary><div class="answer"><p data-field="@2"></p></div></details></template></div>`,
  );
}

/** How to reach the business, from the site's details (so a phone changed in one place changes here too). */
function boundContact(title: string | undefined) {
  const row = (label: string, key: string) =>
    `<div data-everyops-if="site.${key}"><dt>${label}</dt><dd data-everyops-text="site.${key}"></dd></div>`;
  return `<section id="contact" class="section" data-everyops-if="site.contact"><h2 class="reveal">${esc(title ?? "Visit us")}</h2><dl class="contact reveal">${row("Phone", "phone")}${row("Email", "email")}${row("Address", "address")}${row("Hours", "hours")}</dl></section>`;
}

/** The hero's right side: the first few offers with their prices, what to know before booking, and the button. */
function boundGlance(hero: Hero | undefined, offer: Records | undefined, cta: string) {
  const picks = offer
    ? `<p class="label">${esc(offer.title ?? "What we offer")}</p><ul class="picks" data-everyops-hide-empty><template data-everyops-each="page" data-everyops-block="${esc(offer.id)}" data-everyops-limit="3" data-everyops-skip="@title="><li><span data-field="@title"></span><b data-everyops-if="@price" data-field="@price"></b></li></template></ul><a class="more" href="#offer">See all →</a>`
    : "";
  const icons = (Object.keys(ICONS) as HeroFact["kind"][])
    .map((kind) => icon(kind).replace("<svg ", `<svg data-everyops-if="@kind=${kind}" `))
    .join("");
  const facts = hero
    ? `<ul class="facts" data-everyops-hide-empty><template data-everyops-each="page" data-everyops-block="${esc(hero.id)}"${offer ? ' data-everyops-skip="@kind=offer"' : ""}><li>${icons}<span data-field="@text"></span></li></template></ul>`
    : "";
  if (!picks && !facts) return "";
  return `<aside class="glance rise" aria-label="At a glance">${picks}${facts}${cta}</aside>`;
}

/** The page's main button, to the site's booking or order page. */
function ctaOf(hero: Hero | undefined, cls = ""): string {
  return hero?.ctaHref
    ? `<a class="button primary ${cls}" href="${esc(hero.ctaHref)}" target="_top">${esc(hero.ctaLabel ?? "Book now")}</a>`
    : "";
}

/**
 * A part of the page drawn from the workspace's data. Every time the page is shown (on the public site and in the app)
 * EveryOps draws it again from the current records, so prices, courts, services and payment methods are always the
 * ones in the workspace. The words around it are the owner's to edit.
 */
const LIVE = /<!--everyops:live ([a-z_]+)-->[\s\S]*?<!--\/everyops:live \1-->/g;
const live = (id: string, html: string) => `<!--everyops:live ${id}-->${html}<!--/everyops:live ${id}-->`;
export const hasLiveParts = (html: string) => /<!--everyops:live [a-z_]+-->/.test(html);

/** The parts of the page that come from data, by id: the hero card ("glance") and each data section. */
export function liveParts(blocks: ResolvedBlock[]): Record<string, string> {
  const hero = blocks.find((b): b is Hero => b.type === "hero");
  const offer = blocks.find(
    (b): b is Records => b.type === "records" && b.id === "offer" && b.items.length > 0,
  );
  const out: Record<string, string> = { glance: heroCard(hero, offer, ctaOf(hero)) };
  for (const b of blocks) {
    if (b.type === "records" && b.layout === "cards")
      out[b.id] = !b.items.length
        ? ""
        : b.id === "payments"
          ? section(b.id, b.title, `<div class="grid cards">${payCards(b)}</div>`, "pay")
          : section(b.id, b.title, `<div class="grid cards">${offerCards(b)}</div>`);
    if (b.type === "records" && b.layout === "faq") {
      const items = b.items
        .map((i) => {
          const [q, a] = i.cells;
          if (!q?.text) return "";
          return `<details class="reveal"><summary>${esc(q.text)}<span aria-hidden="true" class="plus"></span></summary><div class="answer">${paragraphs(a?.text ?? "")}</div></details>`;
        })
        .join("");
      out[b.id] = items ? section("faq", b.title ?? "Questions", `<div class="faq">${items}</div>`) : "";
    }
    if (b.type === "contact") {
      const rows = [
        ["Phone", b.phone],
        ["Email", b.email],
        ["Address", b.address],
        ["Hours", b.hours],
      ].filter((r): r is [string, string] => !!r[1]);
      const list = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");
      out.contact = rows.length
        ? section("contact", b.title ?? "Visit us", `<dl class="contact reveal">${list}</dl>`)
        : "";
    }
  }
  return out;
}

/** The page with each live part drawn again from parts; parts it doesn't know stay as they are. */
export function refreshLive(html: string, parts: Record<string, string>): string {
  return html.replace(LIVE, (whole, id: string) => (id in parts ? live(id, parts[id]) : whole));
}

/** The whole page, from the standard site's resolved sections (links use SITE_TOKEN for the workspace). */
export function customSiteHtml(name: string, blocks: ResolvedBlock[], about = ""): string {
  const p = paletteFor(name, about);
  const hero = blocks.find((b): b is Hero => b.type === "hero");
  const offer = blocks.find(
    (b): b is Records => b.type === "records" && b.id === "offer" && b.items.length > 0,
  );
  const button = (cls: string) => ctaOf(hero, cls);
  const cta = button("");
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === "highlights" && b.items.length) {
      const items = b.items
        .map(
          (i, n) =>
            `<div class="point reveal"><span class="mark">${String(n + 1).padStart(2, "0")}</span><h3>${esc(i.title)}</h3><p>${esc(i.body)}</p></div>`,
        )
        .join("");
      parts.push(section("why", b.title, `<div class="grid three">${items}</div>`, "plain"));
    }
    // Data sections are bound, kept even while empty so records added later show up.
    if (b.type === "records" && b.layout === "cards") parts.push(boundCards(b));
    if (b.type === "records" && b.layout === "faq") parts.push(boundFaq(b));
    if (b.type === "contact") parts.push(boundContact(b.title));
    if (b.type === "steps" && b.items.length) {
      const items = b.items
        .map(
          (i, n) =>
            `<li class="reveal"><span class="num">${n + 1}</span><div><h3>${esc(i.title)}</h3><p>${esc(i.body)}</p></div></li>`,
        )
        .join("");
      parts.push(
        section(
          "how",
          b.title ?? "How it works",
          `<ol class="steps">${items}</ol>${cta ? `<div class="again reveal">${cta}</div>` : ""}`,
        ),
      );
    }
  }
  const has = (id: string) => parts.some((x) => x.includes(`id="${id}"`));
  const navLinks = [
    offer ? `<a href="#offer">${esc(offer.title ?? "What we offer")}</a>` : "",
    has("how") ? '<a href="#how">How it works</a>' : "",
    has("faq") ? '<a href="#faq">FAQs</a>' : "",
  ].join("");
  const secondary = offer
    ? `<a class="button" href="#offer">${esc(hero?.secondaryLabel ?? "See what we offer")}</a>`
    : "";
  const lead = hero?.subheading ? `<p class="lead rise">${esc(hero.subheading)}</p>` : "";
  // The line above the headline says something the headline doesn't: opening hours, or how much there is to book.
  const note = hero?.facts?.find((f) => f.kind === "hours") ?? hero?.facts?.find((f) => f.kind === "offer");
  const eyebrow = note ? `<span class="eyebrow rise">${esc(note.text)}</span>` : "";
  const glance = boundGlance(hero, offer, cta);
  const initial = esc(name.trim().charAt(0).toUpperCase() || "•");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
${fontLink(p)}
<style>
  :root {
    --bg: ${p.bg}; --ink: ${p.ink}; --soft: ${p.soft}; --accent: ${p.accent}; --tint: ${p.tint}; --card: ${p.card};
    --display: "${p.font}", ui-serif, Georgia, serif;
    --line: color-mix(in oklab, var(--ink) 11%, transparent);
    /* Strong ease-out for anything entering or answering a press; ease-in is never used. */
    --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
    --radius: 18px;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  a { color: inherit; }
  h1, h2, h3, nav strong { font-family: var(--display); font-weight: ${p.weight}; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 8px; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; }
  nav { position: sticky; top: 0; z-index: 2; backdrop-filter: saturate(1.4) blur(12px); background: color-mix(in oklab, var(--bg) 84%, transparent); border-bottom: 1px solid var(--line); }
  nav .wrap { display: flex; align-items: center; justify-content: space-between; gap: 16px; height: 64px; }
  .brand { display: flex; align-items: center; gap: 10px; text-decoration: none; min-width: 0; }
  .brand i { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: var(--accent); color: #fff; font: 700 15px/1 var(--display); font-style: normal; }
  nav strong { font-size: 18px; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  nav .links { display: flex; gap: 22px; align-items: center; font-size: 14px; }
  nav .links a:not(.button) { text-decoration: none; color: var(--soft); transition: color 150ms ease; }
  .button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 0 22px; border-radius: 999px; font-weight: 600; font-size: 15px; text-decoration: none; border: 1px solid var(--line); background: var(--card);
    /* Presses answer at once: 160 ms, transform only. */
    transition: transform 160ms var(--ease-out), background-color 150ms ease, box-shadow 150ms ease; }
  .button:active { transform: scale(0.97); }
  .button.primary { background: var(--accent); color: #fff; border-color: transparent; box-shadow: 0 1px 0 rgb(255 255 255 / .2) inset, 0 8px 22px -10px var(--accent); }
  .button.small { min-height: 38px; padding: 0 16px; font-size: 14px; }
  header.hero { padding: 80px 0 72px; background: radial-gradient(1200px 420px at 85% -10%, var(--tint), transparent 70%); }
  .hero-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.9fr); gap: 56px; align-items: center; }
  .hero-grid.solo { grid-template-columns: minmax(0, 1fr); max-width: 820px; }
  .eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--accent); background: var(--tint); padding: 5px 12px; border-radius: 999px; }
  .eyebrow::before { content: ""; width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
  h1 { font-size: clamp(40px, 6.4vw, 70px); line-height: 1.02; letter-spacing: -0.03em; margin: 20px 0 18px; max-width: 15ch; text-wrap: balance; }
  .lead { font-size: clamp(17px, 2vw, 20px); color: var(--soft); max-width: 50ch; margin: 0 0 32px; text-wrap: pretty; }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; }
  .glance { background: var(--card); border: 1px solid var(--line); border-radius: 24px; padding: 24px; box-shadow: 0 30px 60px -40px rgb(0 0 0 / .35); display: grid; gap: 18px; }
  .glance .label { margin: 0; font-size: 12.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--soft); }
  .picks { list-style: none; margin: -6px 0 0; padding: 0; }
  .picks li { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--line); }
  .picks li b { white-space: nowrap; }
  .more { font-size: 14px; color: var(--accent); text-decoration: none; font-weight: 600; margin-top: -8px; }
  .facts { list-style: none; margin: 0; padding: 14px; display: grid; gap: 10px; background: var(--tint); border-radius: 14px; font-size: 14.5px; }
  .facts li { display: flex; gap: 10px; align-items: center; }
  .facts svg { color: var(--accent); flex: none; }
  .glance .button { width: 100%; }
  /* Entrances: opacity and 8 px of travel, 300 ms, staggered 60 ms. Decorative only; nothing waits on them. */
  .rise { opacity: 0; transform: translateY(8px); animation: rise 300ms var(--ease-out) forwards; }
  .rise:nth-child(2) { animation-delay: 60ms; } .rise:nth-child(3) { animation-delay: 120ms; } .rise:nth-child(4) { animation-delay: 180ms; }
  .glance.rise { animation-delay: 160ms; }
  @keyframes rise { to { opacity: 1; transform: none; } }
  .section { padding: 80px 0; border-top: 1px solid var(--line); }
  .section > h2 { font-size: clamp(28px, 3.6vw, 40px); line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 36px; max-width: 22ch; }
  .section.plain { border-top: 0; padding-top: 8px; }
  .grid { display: grid; gap: 16px; }
  .grid.three { grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 28px; }
  .grid.cards { grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
  .point .mark { display: block; font: 600 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--accent); margin-bottom: 14px; padding-top: 14px; border-top: 2px solid var(--accent); width: 40px; }
  .point h3, .card h3, .steps h3 { margin: 0 0 6px; font-size: 19px; letter-spacing: -0.01em; line-height: 1.25; }
  .point p, .steps p { margin: 0; color: var(--soft); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 22px; display: flex; flex-direction: column; transition: transform 200ms var(--ease-out), box-shadow 200ms var(--ease-out); }
  .card img { width: calc(100% + 44px); margin: -22px -22px 18px; aspect-ratio: 16 / 10; object-fit: cover; border-radius: var(--radius) var(--radius) 0 0; }
  .tags { margin: 0 0 10px; display: flex; flex-wrap: wrap; gap: 6px; }
  .tags span { font-size: 12px; font-weight: 600; color: var(--accent); background: var(--tint); padding: 3px 10px; border-radius: 999px; }
  .card .about { margin: 0 0 4px; color: var(--soft); font-size: 14.5px; }
  .card .about.clamp { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .card dl { margin: auto 0 0; padding-top: 14px; display: grid; gap: 6px; font-size: 14px; }
  .card dl div { display: flex; justify-content: space-between; gap: 12px; border-top: 1px dashed var(--line); padding-top: 6px; }
  .card dt { color: var(--soft); } .card dd { margin: 0; font-weight: 600; text-align: right; }
  .pay .card { background: var(--tint); border-color: transparent; }
  .pay .grid.cards { align-items: start; }
  .pay .card dl div { border-top-color: color-mix(in oklab, var(--ink) 14%, transparent); }
  .steps { list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .steps li { display: flex; flex-direction: column; gap: 14px; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 22px; }
  .num { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 999px; background: var(--accent); color: #fff; font-weight: 700; font-size: 14px; }
  .again { margin-top: 32px; }
  .faq { display: grid; gap: 10px; max-width: 780px; }
  details { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 0 20px; }
  summary { cursor: pointer; list-style: none; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 18px 0; font-weight: 600; }
  summary::-webkit-details-marker { display: none; }
  .plus { position: relative; width: 12px; height: 12px; flex: none; }
  .plus::before, .plus::after { content: ""; position: absolute; inset: 5px 0 auto; height: 2px; background: var(--soft); border-radius: 2px; transition: transform 200ms var(--ease-out); }
  .plus::after { transform: rotate(90deg); }
  details[open] .plus::after { transform: rotate(0deg); }
  .answer { color: var(--soft); padding-bottom: 18px; }
  .answer p { margin: 0 0 8px; white-space: pre-line; }
  [hidden] { display: none !important; }
  .contact { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 0; }
  .contact div { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; }
  .contact dt { color: var(--soft); font-size: 13px; } .contact dd { margin: 2px 0 0; font-weight: 600; }
  .closing { margin: 0 0 72px; padding: 48px; border-radius: 28px; background: var(--ink); color: var(--bg); display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-wrap: wrap; }
  .closing h2 { margin: 0; font-size: clamp(26px, 3.4vw, 38px); letter-spacing: -0.02em; line-height: 1.1; max-width: 18ch; }
  footer { padding: 32px 0 48px; color: var(--soft); font-size: 14px; border-top: 1px solid var(--line); }
  footer .wrap { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: center; }
  /* Scroll reveals: the same 300 ms fade and rise, once, as each part comes into view. */
  .reveal { opacity: 0; transform: translateY(8px); transition: opacity 300ms var(--ease-out), transform 300ms var(--ease-out); }
  .reveal.in { opacity: 1; transform: none; }
  /* Hover lifts only where there is a real pointer; taps on phones would leave them stuck. */
  @media (hover: hover) and (pointer: fine) {
    .button.primary:hover { background: color-mix(in oklab, var(--accent) 88%, #000); }
    .card:hover { transform: translateY(-2px); box-shadow: 0 14px 32px -20px rgb(0 0 0 / .35); }
    nav .links a:not(.button):hover, .more:hover { color: var(--ink); }
  }
  /* Reduced motion keeps the fades that help, without movement. */
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .rise, .reveal { transform: none; }
    .rise { animation-name: fade; }
    .button:active, .card:hover { transform: none; }
  }
  @keyframes fade { to { opacity: 1; } }
  @media (max-width: 900px) { .hero-grid { grid-template-columns: minmax(0, 1fr); gap: 36px; } }
  @media (max-width: 640px) {
    nav .links a:not(.button) { display: none; }
    header.hero { padding: 48px 0 40px; }
    .section { padding: 56px 0; }
    .closing { padding: 28px; border-radius: 22px; }
  }
</style>
</head>
<body>
<nav><div class="wrap"><a class="brand" href="#top"><i aria-hidden="true">${initial}</i><strong data-everyops-text="site.name">${esc(name)}</strong></a><div class="links">${navLinks}${button("small")}</div></div></nav>
<main id="top">
<header class="hero"><div class="wrap hero-grid${glance ? "" : " solo"}">
  <div>
    ${eyebrow}
    <h1 class="rise">${esc(hero?.heading ?? name)}</h1>
    ${lead}
    <div class="actions rise">${cta}${secondary}</div>
  </div>
  ${glance}
</div></header>
<div class="wrap">
${parts.join("\n")}
${cta ? `<div class="closing reveal"><h2>Ready to ${esc((hero?.ctaLabel ?? "Book now").toLowerCase().replace(/\s+now$/, ""))}?</h2>${cta}</div>` : ""}
</div>
</main>
<footer><div class="wrap"><span>© ${new Date().getFullYear()} <span data-everyops-text="site.name">${esc(name)}</span></span><span>Booking by EveryOps</span></div></footer>
<script>
  // Reveal each part once as it scrolls into view, including cards the data bindings add (everyops:bound).
  // Without IntersectionObserver everything simply shows.
  (function () {
    var seen = "IntersectionObserver" in window && new IntersectionObserver(function (entries) {
      entries.forEach(function (e, i) {
        if (!e.isIntersecting) return;
        e.target.style.transitionDelay = Math.min(i * 50, 200) + "ms";
        e.target.classList.add("in");
        seen.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    function watch() {
      document.querySelectorAll(".reveal:not(.in):not([data-watched])").forEach(function (el) {
        if (!seen) return el.classList.add("in");
        el.setAttribute("data-watched", "");
        seen.observe(el);
      });
    }
    watch();
    document.addEventListener("everyops:bound", watch);
  })();
</script>
</body>
</html>
`;
}

/**
 * A custom website with its live parts drawn from the workspace's current data. Pages setup made carry their sections
 * (view.live); older ones made before live parts get their offer and payment sections, found by the ids setup always
 * gave them, drawn from the standard site's sections. Any other HTML page comes back as it is.
 */
export function liveSiteHtml(
  bp: Blueprint,
  records: DataRecord[],
  docs: PageDocs,
  view: HtmlPageView,
  html: string,
  now = new Date(),
): string {
  const marked = hasLiveParts(html);
  const legacy =
    !marked &&
    /<section id="(offer|payments)" class="section/.test(html) &&
    html.includes("Reveal each part once");
  if (!marked && !legacy) return html;
  const parts = liveParts(resolveLive(bp, records, docs, view, now));
  if (marked) return refreshLive(html, parts);
  return html.replace(
    /<section id="(offer|payments)" class="section[^"]*">[\s\S]*?<\/section>/g,
    (whole, id: string) => (parts[id] ? parts[id] : whole),
  );
}

function resolveLive(bp: Blueprint, records: DataRecord[], docs: PageDocs, view: HtmlPageView, now: Date) {
  const landing = {
    id: view.id,
    entityId: "",
    name: view.name,
    type: "landing",
    layout: "standard",
    blocks: view.live?.blocks ?? standardBlocks(bp, bp.workspaceName || view.name),
  } as LandingView;
  return resolveBlocks(bp, records, docs, SITE_TOKEN, landing, now);
}

/**
 * A website setup made: its sections worked out from the current data, for EveryOps.data("page") and the bindings
 * that draw its offers, prices, ways to pay and FAQs. Undefined for pages without sections of their own.
 */
export function liveBlocksOf(
  bp: Blueprint,
  records: DataRecord[],
  docs: PageDocs,
  view: HtmlPageView,
  now = new Date(),
): ResolvedBlock[] | undefined {
  if (!view.live) return undefined;
  return resolveLive(bp, records, docs, view, now).filter((b) => b.type !== "html");
}

/** What the business is, for picking its look: its name, what it offers and its record types. */
function aboutOf(bp: Blueprint): string {
  const offer = offeringOf(bp);
  return [bp.workspaceName, offer?.pluralName, ...bp.entities.map((e) => e.pluralName)]
    .filter(Boolean)
    .join(" ");
}

/**
 * Setup's website for a business whose customers book on their own: the standard site's sections become one custom
 * HTML page (same id and place), and a booking business also gets a custom HTML booking page that its landing page's
 * buttons open. The booking form stays the place bookings are checked and saved (and the team's in-app form), but
 * visitors never see it: its address redirects to the custom page (FormView.page). Each public booking form also
 * gets the calendar that suits the business. Owners change any of it later (Edit HTML, the Calendar buttons on the
 * form). Runs once the sample records exist, so the pages show real courts, rates and FAQs.
 */
export function withCustomSite(
  bp: Blueprint,
  records: DataRecord[],
  name: string,
  now = new Date(),
): Blueprint {
  for (const v of bp.views)
    if (v.type === "form" && v.public && !v.bookingLayout) {
      const layout = defaultBookingLayout(bp, records, v);
      if (layout) v.bookingLayout = layout;
    }
  const at = bp.views.findIndex((v) => v.type === "landing" && v.layout === "standard");
  const landing = bp.views[at];
  const form = mainForm(bp);
  if (!form) return bp;
  if (bp.entities.find((e) => e.id === form.entityId)?.booking) addBookingPage(bp, form, name, landing?.id);
  if (!landing || landing.type !== "landing") return bp;
  const blocks = resolveBlocks(bp, records, {}, SITE_TOKEN, landing, now);
  const page: HtmlPageView = {
    id: landing.id,
    entityId: "",
    name: landing.name,
    type: "html",
    public: true,
    html: customSiteHtml(name, blocks, aboutOf(bp)),
    // The sections behind the page's live parts: every time it's shown they're drawn again from the current data.
    live: { blocks: landing.blocks ?? [] },
  };
  bp.views[at] = page;
  return bp;
}

/**
 * Adds the custom HTML booking page for a public booking form, beside the landing page in the sidebar (or the form
 * when there's no landing), and points the form at it.
 */
function addBookingPage(bp: Blueprint, form: FormView, name: string, landingId?: string) {
  if (form.page && bp.views.some((v) => v.id === form.page)) return;
  let id = "book_online";
  for (let n = 2; bp.views.some((v) => v.id === id); n++) id = `book_online_${n}`;
  const heading = bookLabel(bp, form.id);
  const page: HtmlPageView = {
    id,
    entityId: "",
    name: "Booking page",
    type: "html",
    public: true,
    html: customBookingHtml({
      name,
      formId: form.id,
      homeHref: `/s/${SITE_TOKEN}`,
      heading,
      intro: form.intro ?? defaultCopy(bp, name).intro,
      palette: paletteFor(name, aboutOf(bp)),
    }),
  };
  bp.views.push(page);
  const anchor = landingId ?? form.id;
  const system =
    bp.systems.find((s) => s.viewIds.includes(anchor)) ?? bp.systems.find((s) => s.viewIds.includes(form.id));
  if (system) system.viewIds.splice(system.viewIds.indexOf(anchor) + 1, 0, id);
  else bp.systems.at(-1)?.viewIds.push(id);
  form.page = id;
}

/**
 * The calendar a booking form starts with: courts side by side when there are a few to choose from, a month calendar
 * when there's one thing to book (a studio, a single room), and the day strip otherwise. Stays always use the month.
 */
export function defaultBookingLayout(
  bp: Blueprint,
  records: DataRecord[],
  form: FormView,
): BookingLayout | undefined {
  const entity = bp.entities.find((e) => e.id === form.entityId);
  const booking = entity?.booking;
  if (!entity || !booking) return undefined;
  if (entity.fields.find((f) => f.id === booking.timeFieldId)?.range === "dates") return undefined;
  const resourceEntity = entity.fields.find((f) => f.id === booking.resourceFieldId)?.relation?.entityId;
  const count = records.filter((r) => r.entityId === resourceEntity).length;
  if (count >= 2 && count <= 8) return "grid";
  if (count === 1) return "month";
  return "days";
}
