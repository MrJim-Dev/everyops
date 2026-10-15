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
import { customBookingHtml } from "./booking-page";
import { type PageDocs, type ResolvedBlock, resolveBlocks } from "./resolve";
import {
  cleanDesign,
  designCss,
  esc,
  heroGlance,
  REFERENCES,
  renderClosing,
  renderContact,
  renderFaq,
  renderFooter,
  renderHero,
  renderHighlights,
  renderNav,
  renderOffer,
  renderPayments,
  renderSteps,
  type SiteDesign,
  type SiteParts,
} from "./site-sections";
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

type Records = Extract<ResolvedBlock, { type: "records" }>;
type Hero = Extract<ResolvedBlock, { type: "hero" }>;
type Contact = Extract<ResolvedBlock, { type: "contact" }>;

/** The look a design asks for (its theme), else the one that fits the business. */
export function themeFor(name: string, about: string, theme?: string): SitePalette {
  return PALETTES.find((p) => p.name === theme) ?? paletteFor(name, about);
}

/** The themes an owner can pick, by name. */
export const THEMES = PALETTES.map((p) => ({ id: p.name, accent: p.accent, bg: p.bg, font: p.font }));

/** The page's main button, to the site's booking or order page. */
function ctaOf(hero: Hero | undefined, cls = ""): string {
  return hero?.ctaHref
    ? `<a class="button primary ${cls}" href="${esc(hero.ctaHref)}" target="_top">${esc(hero.ctaLabel ?? "Book now")}</a>`
    : "";
}

/**
 * A part of the page drawn from the workspace's data. Every time the page is shown (on the public site and in the app)
 * EveryOps draws it again from the current records, in the style the site's design picks, so prices, courts, services
 * and payment methods are always the ones in the workspace. The words around it are the owner's to edit.
 */
const LIVE = /<!--everyops:live ([a-z_]+)-->[\s\S]*?<!--\/everyops:live \1-->/g;
const live = (id: string, html: string) => `<!--everyops:live ${id}-->${html}<!--/everyops:live ${id}-->`;
export const hasLiveParts = (html: string) => /<!--everyops:live [a-z_]+-->/.test(html);

/** What every section renderer may use, from the resolved blocks. */
function partsOf(name: string, blocks: ResolvedBlock[]): SiteParts {
  const hero = blocks.find((b): b is Hero => b.type === "hero");
  const offer = blocks.find(
    (b): b is Records => b.type === "records" && b.id === "offer" && b.items.length > 0,
  );
  const has = (test: (b: ResolvedBlock) => boolean) => blocks.some(test);
  const links = [
    offer ? `<a href="#offer">${esc(offer.title ?? "What we offer")}</a>` : "",
    has((b) => b.type === "steps" && b.items.length > 0) ? '<a href="#how">How it works</a>' : "",
    has((b) => b.type === "records" && b.layout === "faq" && b.items.length > 0)
      ? '<a href="#faq">FAQs</a>'
      : "",
  ].join("");
  return {
    name,
    hero,
    offer,
    contact: blocks.find((b): b is Contact => b.type === "contact"),
    cta: ctaOf(hero),
    ctaSmall: ctaOf(hero, "small"),
    ...(hero?.ctaHref ? { ctaHref: hero.ctaHref } : {}),
    links,
  };
}

/** The parts of the page that come from data, by id, drawn in the design's styles: the hero's data and each data section. */
export function liveParts(
  name: string,
  blocks: ResolvedBlock[],
  design?: Partial<SiteDesign>,
): Record<string, string> {
  const d = cleanDesign(design);
  const p = partsOf(name, blocks);
  const out: Record<string, string> = { glance: heroGlance(d.hero, p) };
  for (const b of blocks) {
    if (b.type === "records" && b.layout === "cards")
      out[b.id] = b.id === "payments" ? renderPayments(d.payments, b) : renderOffer(d.offer, b, p);
    if (b.type === "records" && b.layout === "faq") out[b.id] = renderFaq(d.faq, b);
    if (b.type === "contact") out.contact = renderContact(d.contact, b, p);
  }
  return out;
}

/** The page with each live part drawn again from parts; parts it doesn't know stay as they are. */
export function refreshLive(html: string, parts: Record<string, string>): string {
  return html.replace(LIVE, (whole, id: string) => (id in parts ? live(id, parts[id]) : whole));
}

/**
 * The whole page from the standard site's resolved sections, each in the style the design picks (links use
 * SITE_TOKEN for the workspace). Data sections are live parts, kept even while empty so records added later show up.
 */
export function customSiteHtml(
  name: string,
  blocks: ResolvedBlock[],
  about = "",
  design?: Partial<SiteDesign>,
): string {
  const d = cleanDesign(design);
  const p = themeFor(name, about, d.theme);
  const parts = partsOf(name, blocks);
  const fresh = liveParts(name, blocks, d);
  const body: string[] = [];
  for (const b of blocks) {
    if (b.type === "highlights") body.push(renderHighlights(d.highlights, b, parts));
    if (b.type === "steps") body.push(renderSteps(d.steps, b, parts));
    if (b.type === "records" && (b.layout === "cards" || b.layout === "faq"))
      body.push(live(b.id, fresh[b.id] ?? ""));
    if (b.type === "contact") body.push(live("contact", fresh.contact ?? ""));
  }
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
    --display: "${p.font}", ui-serif, Georgia, serif; --display-weight: ${p.weight};
    --line: color-mix(in oklab, var(--ink) 11%, transparent);
    /* Strong ease-out for anything entering or answering a press; ease-in is never used. */
    --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
    --radius: 18px;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  a { color: inherit; }
  h1, h2, h3, nav strong { font-family: var(--display); font-weight: var(--display-weight); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 8px; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; }
  .brand { display: flex; align-items: center; gap: 10px; text-decoration: none; min-width: 0; }
  .brand i { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: var(--accent); color: #fff; font: 700 15px/1 var(--display); font-style: normal; }
  nav strong { font-size: 18px; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  nav .links { display: flex; gap: 22px; align-items: center; font-size: 14px; }
  nav .links a:not(.button) { text-decoration: none; color: var(--soft); transition: color 150ms ease; }
  .button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 0 22px; border-radius: 999px; font-weight: 600; font-size: 15px; text-decoration: none; border: 1px solid var(--line); background: var(--card); color: var(--ink);
    /* Presses answer at once: 160 ms, transform only. */
    transition: transform 160ms var(--ease-out), background-color 150ms ease, box-shadow 150ms ease; }
  .button:active { transform: scale(0.97); }
  .button.primary { background: var(--accent); color: #fff; border-color: transparent; box-shadow: 0 1px 0 rgb(255 255 255 / .2) inset, 0 8px 22px -10px var(--accent); }
  .button.small { min-height: 38px; padding: 0 16px; font-size: 14px; }
  .link { color: var(--accent); font-weight: 600; text-decoration: none; white-space: nowrap; }
  .grid2 { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.9fr); gap: 56px; align-items: center; }
  .grid2.solo { grid-template-columns: minmax(0, 1fr); max-width: 820px; }
  .eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--accent); background: var(--tint); padding: 5px 12px; border-radius: 999px; }
  .eyebrow::before { content: ""; width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
  h1 { font-size: clamp(40px, 6.4vw, 70px); line-height: 1.02; letter-spacing: -0.03em; margin: 20px 0 18px; max-width: 15ch; text-wrap: balance; }
  .lead { font-size: clamp(17px, 2vw, 20px); color: var(--soft); max-width: 50ch; margin: 0 0 32px; text-wrap: pretty; }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; }
  .label { margin: 0 0 6px; font-size: 12.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--soft); }
  .glance { background: var(--card); border: 1px solid var(--line); border-radius: 24px; padding: 24px; box-shadow: 0 30px 60px -40px rgb(0 0 0 / .35); display: grid; gap: 18px; }
  .picks, .leaders { list-style: none; margin: 0; padding: 0; }
  .picks li { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--line); }
  .leaders li { display: flex; align-items: baseline; gap: 10px; padding: 12px 0; font-size: 17px; }
  .leaders li span { order: 0; } .leaders li::after { content: ""; order: 1; flex: 1; border-bottom: 2px dotted color-mix(in oklab, var(--ink) 25%, transparent); }
  .leaders li b { order: 2; }
  .picks li b, .leaders li b { white-space: nowrap; }
  .more { font-size: 14px; color: var(--accent); text-decoration: none; font-weight: 600; }
  .facts { list-style: none; margin: 0; padding: 14px; display: grid; gap: 10px; background: var(--tint); border-radius: 14px; font-size: 14.5px; }
  .facts.plain { background: none; padding: 0; }
  .facts li, .pills li { display: flex; gap: 10px; align-items: center; }
  .facts svg, .pills svg { color: var(--accent); flex: none; }
  .pills { list-style: none; margin: 36px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 10px; }
  .pills li { padding: 8px 14px; border-radius: 999px; background: var(--card); border: 1px solid var(--line); font-size: 14px; gap: 8px; }
  .glance .button { width: 100%; }
  /* Entrances: opacity and 8 px of travel, 300 ms, staggered 60 ms. Decorative only; nothing waits on them. */
  .rise { opacity: 0; transform: translateY(8px); animation: rise 300ms var(--ease-out) forwards; }
  .rise:nth-child(2) { animation-delay: 60ms; } .rise:nth-child(3) { animation-delay: 120ms; } .rise:nth-child(4) { animation-delay: 180ms; }
  .glance.rise { animation-delay: 160ms; }
  @keyframes rise { to { opacity: 1; transform: none; } }
  .section { padding: 80px 0; border-top: 1px solid var(--line); }
  .section h2 { font-size: clamp(28px, 3.6vw, 40px); line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 36px; max-width: 22ch; }
  .grid { display: grid; gap: 16px; }
  .grid.three { grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 28px; }
  .grid.cards { grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
  .point h3, .card h3, .steps h3, .row h3 { margin: 0 0 6px; font-size: 19px; letter-spacing: -0.01em; line-height: 1.25; }
  .point p, .steps p { margin: 0; color: var(--soft); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 22px; display: flex; flex-direction: column; transition: transform 200ms var(--ease-out), box-shadow 200ms var(--ease-out); }
  .card img { width: calc(100% + 44px); margin: -22px -22px 18px; aspect-ratio: 16 / 10; object-fit: cover; border-radius: var(--radius) var(--radius) 0 0; }
  .tags { margin: 0 0 10px; display: flex; flex-wrap: wrap; gap: 6px; }
  .tags span { font-size: 12px; font-weight: 600; color: var(--accent); background: var(--tint); padding: 3px 10px; border-radius: 999px; }
  .about { margin: 0 0 4px; color: var(--soft); font-size: 14.5px; }
  .card dl, .row dl { margin: auto 0 0; padding-top: 14px; display: grid; gap: 6px; font-size: 14px; }
  .card dl div, .row dl div { display: flex; justify-content: space-between; gap: 12px; border-top: 1px dashed var(--line); padding-top: 6px; }
  .card dt, .row dt { color: var(--soft); } .card dd, .row dd { margin: 0; font-weight: 600; text-align: right; }
  .steps { list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; }
  .steps li { display: flex; gap: 14px; }
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
  .answer p { margin: 0 0 8px; }
  .contact { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 0; }
  dt { color: var(--soft); font-size: 13px; } dd { margin: 2px 0 0; font-weight: 600; }
  ${designCss(d)}
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
  @media (max-width: 900px) {
    .grid2, .hero-editorial .cols, .hl-split, .st-split, .pay-split, .faq-split, .ct-split, .hl-spotlight .spot, .of-feature .feature, .of-rows .row, .hl-list .row, .pay-list .row { grid-template-columns: minmax(0, 1fr); gap: 28px; }
    .hl-split .side, .st-split .side, .pay-split .side, .faq-split .side, .ct-split .side { position: static; }
    .nav-centered .wrap { grid-template-columns: 1fr auto; } .nav-centered .links { display: none; } .nav-centered .brand { align-items: flex-start; }
    .hero-menu .menu-list { border-left: 0; padding-left: 0; }
    .st-inline .steps li::after { display: none; }
  }
  @media (max-width: 640px) {
    nav .links a:not(.button) { display: none; }
    .hero-split, .hero-centered, .hero-editorial, .hero-menu, .hero-stats, .hero-dark { padding: 48px 0 40px; }
    .section { padding: 56px 0; }
    .close-dark, .close-accent, .close-split { padding: 28px; border-radius: 22px; }
    .st-numbers .steps li { grid-template-columns: 56px 1fr; } .st-numbers .num { font-size: 48px; }
    .foot-columns .wrap:first-child { grid-template-columns: minmax(0, 1fr); }
  }
</style>
</head>
<body>
${renderNav(d.nav, parts)}
<main id="top">
${renderHero(d.hero, parts, live("glance", fresh.glance ?? ""))}
<div class="wrap">
${body.join("\n")}
${renderClosing(d.closing, parts)}
</div>
</main>
${renderFooter(d.footer, parts)}
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
 * A custom website with its live parts drawn from the workspace's current data, in its design's styles. Pages setup
 * made carry their sections and design (view.live); older ones made before live parts get their offer and payment
 * sections, found by the ids setup always gave them, drawn from the standard site's sections. Any other HTML page
 * comes back as it is.
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
  const blocks = view.live?.blocks ?? standardBlocks(bp, bp.workspaceName || view.name);
  const landing = {
    id: view.id,
    entityId: "",
    name: view.name,
    type: "landing",
    layout: "standard",
    blocks,
  } as LandingView;
  const name = bp.workspaceName || view.name;
  const parts = liveParts(
    name,
    resolveBlocks(bp, records, docs, SITE_TOKEN, landing, now),
    view.live?.design,
  );
  if (marked) return refreshLive(html, parts);
  return html.replace(
    /<section id="(offer|payments)" class="section[^"]*">[\s\S]*?<\/section>/g,
    (whole, id: string) => (parts[id] ? parts[id] : whole),
  );
}

/**
 * The starting design for a business: one of the reference sites for its kind (court venues, salons, stays, cafés,
 * clinics, shops), picked by its name so two similar businesses don't get the same site.
 */
export function referenceDesign(name: string, about = ""): SiteDesign {
  const kind = paletteFor(name, about).name;
  const refs = REFERENCES.filter((r) => r.kind === kind);
  let h = 7;
  for (const c of name) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return cleanDesign((refs.length ? refs : REFERENCES)[h % (refs.length || REFERENCES.length)].design);
}

/**
 * A setup website drawn again in another design, from the workspace's current data: the page itself and, when the
 * site has one, its booking page (same theme, the design's booking layout). The owner's design picker saves both.
 */
export function redesignSite(
  bp: Blueprint,
  records: DataRecord[],
  docs: PageDocs,
  view: HtmlPageView,
  design: Partial<SiteDesign>,
  now = new Date(),
): { html: string; booking?: { viewId: string; html: string } } {
  const d = cleanDesign(design);
  const name = bp.workspaceName || view.name;
  const blocks = view.live?.blocks ?? standardBlocks(bp, name);
  const landing = {
    id: view.id,
    entityId: "",
    name: view.name,
    type: "landing",
    layout: "standard",
    blocks,
  } as LandingView;
  const html = customSiteHtml(
    name,
    resolveBlocks(bp, records, docs, SITE_TOKEN, landing, now),
    aboutOf(bp),
    d,
  );
  const form = mainForm(bp);
  const page = form?.page ? bp.views.find((v) => v.id === form.page && v.type === "html") : undefined;
  return form && page
    ? { html, booking: { viewId: page.id, html: bookingPageHtml(bp, form, name, d) } }
    : { html };
}

/** The design a setup website was made with (or the one that suits it, for older sites). */
export function designOf(bp: Blueprint, view: HtmlPageView): SiteDesign {
  return view.live?.design
    ? cleanDesign(view.live.design)
    : referenceDesign(bp.workspaceName || view.name, aboutOf(bp));
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
  /** The styles chosen for this business (by the AI); the rest come from its reference site. */
  chosen?: Partial<SiteDesign>,
): Blueprint {
  const design = cleanDesign({ ...referenceDesign(name, aboutOf(bp)), ...chosen });
  for (const v of bp.views)
    if (v.type === "form" && v.public && !v.bookingLayout) {
      const layout = defaultBookingLayout(bp, records, v);
      if (layout) v.bookingLayout = layout;
    }
  const at = bp.views.findIndex((v) => v.type === "landing" && v.layout === "standard");
  const landing = bp.views[at];
  const form = mainForm(bp);
  if (!form) return bp;
  if (bp.entities.find((e) => e.id === form.entityId)?.booking)
    addBookingPage(bp, form, name, design, landing?.id);
  if (!landing || landing.type !== "landing") return bp;
  const blocks = resolveBlocks(bp, records, {}, SITE_TOKEN, landing, now);
  const page: HtmlPageView = {
    id: landing.id,
    entityId: "",
    name: landing.name,
    type: "html",
    public: true,
    html: customSiteHtml(name, blocks, aboutOf(bp), design),
    // The sections behind the page's live parts and their styles: every time it's shown they're drawn again from
    // the current data.
    live: { blocks: landing.blocks ?? [], design: { ...design } },
  };
  bp.views[at] = page;
  return bp;
}

/** The custom booking page for a public form, in a design's theme and booking layout. */
export function bookingPageHtml(
  bp: Blueprint,
  form: FormView,
  name: string,
  design?: Partial<SiteDesign>,
): string {
  const d = cleanDesign(design);
  return customBookingHtml({
    name,
    formId: form.id,
    homeHref: `/s/${SITE_TOKEN}`,
    heading: bookLabel(bp, form.id),
    intro: form.intro ?? defaultCopy(bp, name).intro,
    palette: themeFor(name, aboutOf(bp), d.theme),
    layout: d.booking,
  });
}

/**
 * Adds the custom HTML booking page for a public booking form, beside the landing page in the sidebar (or the form
 * when there's no landing), and points the form at it.
 */
function addBookingPage(bp: Blueprint, form: FormView, name: string, design: SiteDesign, landingId?: string) {
  if (form.page && bp.views.some((v) => v.id === form.page)) return;
  let id = "book_online";
  for (let n = 2; bp.views.some((v) => v.id === id); n++) id = `book_online_${n}`;
  const page: HtmlPageView = {
    id,
    entityId: "",
    name: "Booking page",
    type: "html",
    public: true,
    html: bookingPageHtml(bp, form, name, design),
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
