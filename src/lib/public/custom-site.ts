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
import type { Blueprint, BookingLayout, DataRecord, FormView, HtmlPageView } from "@/lib/blueprint/types";
import { type ResolvedBlock, resolveBlocks } from "./resolve";
import { mainForm } from "./site-template";

/** Stands in for the workspace slug in links the page is created with; filled in wherever the page is shown. */
export const SITE_TOKEN = "__everyops_site__";

/** The page's HTML with links to the workspace's own pages pointing at its real address. */
export function withSiteLinks(html: string, slug: string): string {
  return html.split(`/s/${SITE_TOKEN}`).join(`/s/${slug}`);
}

/** A few looks, picked from the business name, so two businesses' sites don't all look the same. */
const PALETTES = [
  { name: "court", bg: "#f6f7f2", ink: "#16201a", soft: "#5b6b60", accent: "#1f7a4d", tint: "#e3efe6" },
  { name: "clay", bg: "#fbf6f1", ink: "#2a1d16", soft: "#7a6458", accent: "#b4532a", tint: "#f5e3d6" },
  { name: "tide", bg: "#f3f6fa", ink: "#141c26", soft: "#566476", accent: "#1d5fa8", tint: "#dfe9f6" },
  { name: "plum", bg: "#f8f4f8", ink: "#22162a", soft: "#6c5a74", accent: "#8a3b8f", tint: "#efe0f0" },
] as const;

export function paletteFor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length];
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

function offerCards(b: Records) {
  return b.items
    .map((item) => {
      const image = item.cells.find((c) => c.kind === "image" && c.text);
      const [title, ...rest] = item.cells.filter((c) => c.kind !== "image" && c.text);
      if (!title) return "";
      const picture = image ? `<img src="${esc(image.text)}" alt="" loading="lazy">` : "";
      const details = rest.length
        ? `<dl>${rest.map((c) => `<div><dt>${esc(c.name)}</dt><dd>${esc(c.text)}</dd></div>`).join("")}</dl>`
        : "";
      return `<article class="card reveal">${picture}<h3>${esc(title.text)}</h3>${details}</article>`;
    })
    .join("");
}

function section(id: string, title: string | undefined, body: string, className = "") {
  if (!body) return "";
  const heading = title ? `<h2 class="reveal">${esc(title)}</h2>` : "";
  return `<section id="${id}" class="section ${className}">${heading}${body}</section>`;
}

/** The whole page, from the standard site's resolved sections (links use SITE_TOKEN for the workspace). */
export function customSiteHtml(name: string, blocks: ResolvedBlock[]): string {
  const p = paletteFor(name);
  const hero = blocks.find((b): b is Hero => b.type === "hero");
  const button = (cls: string) =>
    hero?.ctaHref
      ? `<a class="button primary ${cls}" href="${esc(hero.ctaHref)}" target="_top">${esc(hero.ctaLabel ?? "Book now")}</a>`
      : "";
  const cta = button("");
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === "highlights" && b.items.length) {
      const items = b.items
        .map((i) => `<div class="point reveal"><h3>${esc(i.title)}</h3><p>${esc(i.body)}</p></div>`)
        .join("");
      parts.push(section("why", b.title, `<div class="grid three">${items}</div>`));
    }
    if (b.type === "records" && b.layout === "cards" && b.items.length)
      parts.push(
        section(
          b.id,
          b.title,
          `<div class="grid cards">${offerCards(b)}</div>`,
          b.id === "payments" ? "pay" : "",
        ),
      );
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
    if (b.type === "records" && b.layout === "faq" && b.items.length) {
      const items = b.items
        .map((i) => {
          const [q, a] = i.cells;
          if (!q?.text) return "";
          return `<details class="reveal"><summary>${esc(q.text)}<span aria-hidden="true" class="plus"></span></summary><div class="answer">${paragraphs(a?.text ?? "")}</div></details>`;
        })
        .join("");
      parts.push(section("faq", b.title ?? "Questions", `<div class="faq">${items}</div>`));
    }
    if (b.type === "contact") {
      const rows = [
        ["Phone", b.phone],
        ["Email", b.email],
        ["Address", b.address],
        ["Hours", b.hours],
      ].filter((r): r is [string, string] => !!r[1]);
      const list = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");
      if (rows.length)
        parts.push(section("contact", b.title ?? "Visit us", `<dl class="contact reveal">${list}</dl>`));
    }
  }
  const has = (id: string) => parts.some((x) => x.includes(`id="${id}"`));
  const navLinks = [
    has("how") ? '<a href="#how">How it works</a>' : "",
    has("faq") ? '<a href="#faq">FAQs</a>' : "",
  ].join("");
  const secondary = has("offer") ? '<a class="button" href="#offer">See what we offer</a>' : "";
  const lead = hero?.subheading ? `<p class="lead rise">${esc(hero.subheading)}</p>` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
<style>
  :root {
    --bg: ${p.bg}; --ink: ${p.ink}; --soft: ${p.soft}; --accent: ${p.accent}; --tint: ${p.tint};
    --line: color-mix(in oklab, var(--ink) 12%, transparent);
    /* Strong ease-out for anything entering or answering a press; ease-in is never used. */
    --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
    --radius: 16px;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  a { color: inherit; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 8px; }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 0 24px; }
  nav { position: sticky; top: 0; z-index: 2; backdrop-filter: saturate(1.4) blur(12px); background: color-mix(in oklab, var(--bg) 82%, transparent); border-bottom: 1px solid var(--line); }
  nav .wrap { display: flex; align-items: center; justify-content: space-between; height: 64px; }
  nav strong { font-size: 17px; letter-spacing: -0.01em; }
  nav .links { display: flex; gap: 20px; align-items: center; font-size: 14px; }
  nav .links a:not(.button) { text-decoration: none; color: var(--soft); transition: color 150ms ease; }
  .button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 20px; border-radius: 999px; font-weight: 600; font-size: 15px; text-decoration: none; border: 1px solid var(--line);
    /* Presses answer at once: 160 ms, transform only. */
    transition: transform 160ms var(--ease-out), background-color 150ms ease, box-shadow 150ms ease; }
  .button:active { transform: scale(0.97); }
  .button.primary { background: var(--accent); color: #fff; border-color: transparent; box-shadow: 0 1px 0 rgb(255 255 255 / .2) inset, 0 6px 20px -8px var(--accent); }
  .button.small { min-height: 36px; padding: 0 16px; font-size: 14px; }
  header.hero { padding: 96px 0 72px; }
  .eyebrow { display: inline-block; font-size: 13px; font-weight: 600; color: var(--accent); background: var(--tint); padding: 4px 12px; border-radius: 999px; }
  h1 { font-size: clamp(40px, 7vw, 72px); line-height: 1.02; letter-spacing: -0.035em; margin: 20px 0 16px; max-width: 14ch; }
  .lead { font-size: clamp(17px, 2vw, 20px); color: var(--soft); max-width: 52ch; margin: 0 0 32px; }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; }
  /* Entrances: opacity and 8 px of travel, 300 ms, staggered 60 ms. Decorative only; nothing waits on them. */
  .rise { opacity: 0; transform: translateY(8px); animation: rise 300ms var(--ease-out) forwards; }
  .rise:nth-child(2) { animation-delay: 60ms; } .rise:nth-child(3) { animation-delay: 120ms; } .rise:nth-child(4) { animation-delay: 180ms; }
  @keyframes rise { to { opacity: 1; transform: none; } }
  .section { padding: 72px 0; border-top: 1px solid var(--line); }
  .section > h2 { font-size: clamp(26px, 3.4vw, 36px); letter-spacing: -0.02em; margin: 0 0 32px; }
  .grid { display: grid; gap: 16px; }
  .grid.three { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .grid.cards { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .point h3, .card h3, .steps h3 { margin: 0 0 6px; font-size: 18px; letter-spacing: -0.01em; }
  .point p, .steps p { margin: 0; color: var(--soft); }
  .card { background: #fff; border: 1px solid var(--line); border-radius: var(--radius); padding: 22px; transition: transform 200ms var(--ease-out), box-shadow 200ms var(--ease-out); }
  .card img { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; border-radius: 10px; margin-bottom: 14px; }
  .card dl { margin: 12px 0 0; display: grid; gap: 6px; font-size: 14px; }
  .card dl div { display: flex; justify-content: space-between; gap: 12px; }
  .card dt { color: var(--soft); } .card dd { margin: 0; font-weight: 600; text-align: right; }
  .pay .card { background: var(--tint); border-color: transparent; }
  .steps { list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; }
  .steps li { display: flex; gap: 16px; align-items: flex-start; background: #fff; border: 1px solid var(--line); border-radius: var(--radius); padding: 20px; }
  .num { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 999px; background: var(--accent); color: #fff; font-weight: 700; font-size: 14px; }
  .again { margin-top: 28px; }
  .faq { display: grid; gap: 10px; max-width: 760px; }
  details { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 0 20px; }
  summary { cursor: pointer; list-style: none; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 18px 0; font-weight: 600; }
  summary::-webkit-details-marker { display: none; }
  .plus { position: relative; width: 12px; height: 12px; flex: none; }
  .plus::before, .plus::after { content: ""; position: absolute; inset: 5px 0 auto; height: 2px; background: var(--soft); border-radius: 2px; transition: transform 200ms var(--ease-out); }
  .plus::after { transform: rotate(90deg); }
  details[open] .plus::after { transform: rotate(0deg); }
  .answer { color: var(--soft); padding-bottom: 18px; }
  .answer p { margin: 0 0 8px; }
  .contact { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 0; }
  .contact dt { color: var(--soft); font-size: 13px; } .contact dd { margin: 2px 0 0; font-weight: 600; }
  footer { padding: 40px 0 56px; color: var(--soft); font-size: 14px; border-top: 1px solid var(--line); }
  footer .wrap { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: center; }
  /* Scroll reveals: the same 300 ms fade and rise, once, as each part comes into view. */
  .reveal { opacity: 0; transform: translateY(8px); transition: opacity 300ms var(--ease-out), transform 300ms var(--ease-out); }
  .reveal.in { opacity: 1; transform: none; }
  /* Hover lifts only where there is a real pointer; taps on phones would leave them stuck. */
  @media (hover: hover) and (pointer: fine) {
    .button.primary:hover { background: color-mix(in oklab, var(--accent) 88%, #000); }
    .card:hover { transform: translateY(-2px); box-shadow: 0 12px 32px -18px rgb(0 0 0 / .35); }
    nav .links a:not(.button):hover { color: var(--ink); }
  }
  /* Reduced motion keeps the fades that help, without movement. */
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .rise, .reveal { transform: none; }
    .rise { animation-name: fade; }
    .button:active, .card:hover { transform: none; }
  }
  @keyframes fade { to { opacity: 1; } }
  @media (max-width: 640px) { nav .links a:not(.button) { display: none; } header.hero { padding: 64px 0 48px; } .section { padding: 56px 0; } }
</style>
</head>
<body>
<nav><div class="wrap"><strong>${esc(name)}</strong><div class="links">${navLinks}${button("small")}</div></div></nav>
<main>
<header class="hero"><div class="wrap">
  <span class="eyebrow rise">${esc(name)}</span>
  <h1 class="rise">${esc(hero?.heading ?? name)}</h1>
  ${lead}
  <div class="actions rise">${cta}${secondary}</div>
</div></header>
<div class="wrap">
${parts.join("\n")}
</div>
</main>
<footer><div class="wrap"><span>© ${esc(name)}</span>${cta}</div></footer>
<script>
  // Reveal each part once as it scrolls into view. Without IntersectionObserver everything simply shows.
  (function () {
    var items = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) { items.forEach(function (el) { el.classList.add("in"); }); return; }
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (e, i) {
        if (!e.isIntersecting) return;
        e.target.style.transitionDelay = Math.min(i * 50, 200) + "ms";
        e.target.classList.add("in");
        seen.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    items.forEach(function (el) { seen.observe(el); });
  })();
</script>
</body>
</html>
`;
}

/**
 * Setup's website for a business whose customers book on their own: the standard site's sections become one custom
 * HTML page (same id and place) whose buttons open the booking form, and each public booking form gets the calendar
 * that suits the business, so sites don't all look alike. Owners change either later (Edit HTML, the Calendar
 * buttons on the form). Runs once the sample records exist, so the page shows real courts, rates and FAQs.
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
  if (!landing || landing.type !== "landing" || !mainForm(bp)) return bp;
  const blocks = resolveBlocks(bp, records, {}, SITE_TOKEN, landing, now);
  const page: HtmlPageView = {
    id: landing.id,
    entityId: "",
    name: landing.name,
    type: "html",
    public: true,
    html: customSiteHtml(name, blocks),
  };
  bp.views[at] = page;
  return bp;
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
