/**
 * The custom HTML booking page setup writes for businesses whose customers book on their own. It's the visitor's
 * booking form, in the same look as the custom landing page, and it is plain HTML the owner can open and edit (Edit
 * HTML, or ask EveryOps). Everything that changes is live: the page reads the form through the EveryOps bridge when
 * it opens (courts or rooms, fields, add-ons, payment methods), asks for free times or days as the visitor picks,
 * prices the booking with the same engine as a real one, and sends it to the public form, which checks it exactly
 * like its own page would (double bookings, required fields, offered choices).
 *
 * Motion follows the landing page's rules (Emil Kowalski): strong ease-out, under 300 ms, transform and opacity only,
 * presses scale to 0.97, hover only where there is a pointer, and reduced motion keeps fades without movement.
 */

type Palette = {
  bg: string;
  ink: string;
  soft: string;
  accent: string;
  tint: string;
  /** The landing page's heading font (Google Fonts), so both pages look like one site. */
  font?: string;
  weight?: string;
};

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

export type BookingPageOptions = {
  /** The business name. */
  name: string;
  /** The public form the page sends bookings to. */
  formId: string;
  /** The landing page's address (with the site token), for the header and the done screen. */
  homeHref: string;
  heading: string;
  intro?: string;
  palette: Palette;
};

/** Marks a booking page setup wrote, with the form it books through. */
export const BOOKING_PAGE_MARK = "data-everyops-booking";

export function customBookingHtml(o: BookingPageOptions): string {
  const p = o.palette;
  const intro = o.intro ? `<p class="lead rise">${esc(o.intro)}</p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.heading)} · ${esc(o.name)}</title>
${p.font ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${p.font.replace(/ /g, "+")}:wght@${p.weight ?? "700"}&display=swap">` : ""}
<style>
  ${p.font ? `h1, h2, nav strong { font-family: "${p.font}", ui-serif, Georgia, serif; font-weight: ${p.weight ?? "700"}; }` : ""}
  :root {
    --bg: ${p.bg}; --ink: ${p.ink}; --soft: ${p.soft}; --accent: ${p.accent}; --tint: ${p.tint};
    --line: color-mix(in oklab, var(--ink) 12%, transparent);
    --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
    --radius: 16px;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  a { color: inherit; }
  button, input, select, textarea { font: inherit; color: inherit; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 8px; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 20px; }
  nav { position: sticky; top: 0; z-index: 3; backdrop-filter: saturate(1.4) blur(12px); background: color-mix(in oklab, var(--bg) 84%, transparent); border-bottom: 1px solid var(--line); }
  nav .wrap { display: flex; align-items: center; justify-content: space-between; height: 60px; gap: 12px; }
  nav strong { font-size: 16px; letter-spacing: -0.01em; }
  nav a.back { font-size: 14px; color: var(--soft); text-decoration: none; }
  header.top { padding: 40px 0 8px; }
  .eyebrow { display: inline-block; font-size: 12.5px; font-weight: 600; color: var(--accent); background: var(--tint); padding: 3px 11px; border-radius: 999px; }
  h1 { font-size: clamp(30px, 5vw, 44px); line-height: 1.08; letter-spacing: -0.03em; margin: 14px 0 8px; }
  .lead { color: var(--soft); margin: 0; max-width: 58ch; }
  .rise { opacity: 0; transform: translateY(8px); animation: rise 300ms var(--ease-out) forwards; }
  .rise:nth-child(2) { animation-delay: 60ms; } .rise:nth-child(3) { animation-delay: 120ms; }
  @keyframes rise { to { opacity: 1; transform: none; } }
  .progress { display: flex; gap: 8px; flex-wrap: wrap; margin: 28px 0 20px; padding: 0; list-style: none; }
  .progress li { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--soft); padding: 6px 12px 6px 6px; border-radius: 999px; border: 1px solid var(--line); background: #fff; }
  .progress li span { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 999px; background: var(--tint); color: var(--accent); font-weight: 700; font-size: 12px; }
  .progress li[aria-current="step"] { color: var(--ink); border-color: var(--accent); }
  .progress li[aria-current="step"] span, .progress li.done span { background: var(--accent); color: #fff; }
  .layout { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr) 320px; align-items: start; padding-bottom: 64px; }
  .panel { background: #fff; border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; scroll-margin-top: 80px; }
  .panel h2 { margin: 0 0 4px; font-size: 20px; letter-spacing: -0.015em; }
  .panel .hint { margin: 0 0 18px; color: var(--soft); font-size: 14.5px; }
  .step { animation: fade 220ms var(--ease-out); }
  @keyframes fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .label { font-size: 13px; font-weight: 600; color: var(--soft); margin: 18px 0 8px; }
  .choices { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .choice { text-align: left; border: 1px solid var(--line); background: var(--bg); border-radius: 12px; padding: 12px 14px; cursor: pointer; transition: transform 160ms var(--ease-out), border-color 150ms ease, background-color 150ms ease; }
  .choice:active { transform: scale(0.97); }
  .choice small { display: block; color: var(--soft); font-size: 12.5px; }
  .choice[aria-pressed="true"] { border-color: var(--accent); background: var(--tint); box-shadow: 0 0 0 1px var(--accent) inset; }
  .days { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 6px; scrollbar-width: thin; }
  .day { flex: none; width: 64px; padding: 10px 0; text-align: center; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); cursor: pointer; transition: transform 160ms var(--ease-out), border-color 150ms ease; }
  .day:active { transform: scale(0.97); }
  .day b { display: block; font-size: 19px; letter-spacing: -0.02em; }
  .day small { display: block; font-size: 11.5px; color: var(--soft); text-transform: uppercase; letter-spacing: .04em; }
  .day[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
  .day[aria-pressed="true"] small { color: rgb(255 255 255 / .8); }
  .times { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); }
  .time { padding: 10px 0; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); cursor: pointer; font-weight: 600; font-size: 14px; transition: transform 160ms var(--ease-out), background-color 150ms ease; }
  .time:active { transform: scale(0.97); }
  .time[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
  .time:disabled { text-decoration: line-through; opacity: .45; cursor: not-allowed; }
  .month { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; max-width: 420px; }
  .month .dow { font-size: 11.5px; color: var(--soft); text-align: center; padding-bottom: 2px; }
  .month button { aspect-ratio: 1; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); cursor: pointer; font-weight: 600; transition: transform 160ms var(--ease-out); }
  .month button:active { transform: scale(0.97); }
  .month button.in { background: var(--tint); border-color: var(--accent); }
  .month button.edge { background: var(--accent); color: #fff; border-color: var(--accent); }
  .month button:disabled { opacity: .35; text-decoration: line-through; cursor: not-allowed; }
  .monthbar { display: flex; align-items: center; justify-content: space-between; max-width: 420px; margin-bottom: 10px; font-weight: 600; }
  .monthbar button { border: 1px solid var(--line); background: #fff; border-radius: 999px; width: 34px; height: 34px; cursor: pointer; }
  .monthbar button:disabled { opacity: .4; cursor: not-allowed; }
  .addon { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
  .addon:last-child { border-bottom: 0; }
  .addon small { display: block; color: var(--soft); }
  .qty { display: flex; align-items: center; gap: 4px; }
  .qty button { width: 34px; height: 34px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); cursor: pointer; font-size: 18px; line-height: 1; transition: transform 160ms var(--ease-out); }
  .qty button:active { transform: scale(0.94); }
  .qty output { min-width: 26px; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
  .fields { display: grid; gap: 14px; margin: 0; }
  .field { display: grid; gap: 6px; font-size: 14px; font-weight: 600; }
  .field .req { color: var(--accent); }
  .field small { font-weight: 400; color: var(--soft); }
  .field input:not([type=checkbox]), .field select, .field textarea { width: 100%; padding: 11px 12px; border: 1px solid color-mix(in oklab, var(--ink) 18%, transparent); border-radius: 10px; background: #fff; font-weight: 400; }
  .field.check { display: flex; align-items: center; gap: 10px; font-weight: 500; }
  .field .error { color: #b42318; font-weight: 500; font-size: 13px; }
  .pay { display: grid; gap: 10px; }
  .pay .choice { display: flex; gap: 14px; align-items: flex-start; width: 100%; }
  .pay img { width: 112px; height: 112px; object-fit: cover; border-radius: 10px; background: #fff; flex: none; }
  .pay dl { margin: 6px 0 0; font-size: 13.5px; display: grid; gap: 2px; }
  .pay dt { display: inline; color: var(--soft); } .pay dd { display: inline; margin: 0 0 0 4px; font-weight: 600; }
  .actions { display: flex; justify-content: space-between; gap: 10px; margin-top: 24px; }
  .button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 0 22px; border-radius: 999px; font-weight: 600; font-size: 15px; border: 1px solid var(--line); background: #fff; cursor: pointer; text-decoration: none; transition: transform 160ms var(--ease-out), background-color 150ms ease; }
  .button:active { transform: scale(0.97); }
  .button.primary { background: var(--accent); color: #fff; border-color: transparent; box-shadow: 0 6px 20px -8px var(--accent); }
  .button:disabled { opacity: .5; cursor: not-allowed; }
  aside.summary { position: sticky; top: 76px; background: #fff; border: 1px solid var(--line); border-radius: var(--radius); padding: 20px; }
  aside.summary h3 { margin: 0 0 12px; font-size: 15px; }
  aside.summary dl { margin: 0; display: grid; gap: 10px; font-size: 14px; }
  aside.summary dl div { display: flex; justify-content: space-between; gap: 12px; }
  aside.summary dt { color: var(--soft); } aside.summary dd { margin: 0; text-align: right; font-weight: 600; }
  aside.summary .total { border-top: 1px dashed var(--line); padding-top: 10px; margin-top: 4px; }
  aside.summary .empty { color: var(--soft); font-size: 14px; margin: 0; }
  .notice { border-radius: 12px; padding: 12px 14px; font-size: 14px; margin-top: 16px; background: var(--tint); }
  .notice.error { background: #fdecea; color: #8a1c12; }
  .muted { color: var(--soft); font-size: 14px; }
  .done { text-align: center; padding: 40px 24px; }
  .done .tick { width: 56px; height: 56px; border-radius: 999px; margin: 0 auto 16px; display: grid; place-items: center; background: var(--accent); color: #fff; font-size: 28px; animation: pop 280ms var(--ease-out); }
  @keyframes pop { from { opacity: 0; transform: scale(.9); } to { opacity: 1; transform: none; } }
  .done dl { text-align: left; max-width: 380px; margin: 20px auto; display: grid; gap: 8px; font-size: 14.5px; }
  .done dl div { display: flex; justify-content: space-between; gap: 12px; } .done dt { color: var(--soft); } .done dd { margin: 0; font-weight: 600; text-align: right; }
  .skeleton { height: 120px; border-radius: 12px; background: linear-gradient(90deg, var(--tint), #fff, var(--tint)); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; }
  @keyframes shimmer { to { background-position: -200% 0; } }
  @media (hover: hover) and (pointer: fine) {
    .choice:hover, .day:hover, .time:hover:not(:disabled) { border-color: var(--accent); }
    .button.primary:hover:not(:disabled) { background: color-mix(in oklab, var(--accent) 88%, #000); }
    nav a.back:hover { color: var(--ink); }
  }
  @media (prefers-reduced-motion: reduce) {
    .rise, .step, .done .tick { animation-name: fadeonly; transform: none; }
    .choice:active, .day:active, .time:active, .button:active, .qty button:active, .month button:active { transform: none; }
  }
  @keyframes fadeonly { from { opacity: 0; } to { opacity: 1; } }
  @media (max-width: 860px) { .layout { grid-template-columns: 1fr; } aside.summary { position: static; } }
  .sign { display: block; width: 100%; max-width: 420px; height: 140px; border: 1px solid #d4d4d8; border-radius: 10px; background: #fff; touch-action: none; cursor: crosshair; }
  .signed { display: flex; align-items: center; gap: 12px; font-size: 14px; }
</style>
</head>
<body ${BOOKING_PAGE_MARK}="${esc(o.formId)}">
<nav><div class="wrap"><strong>${esc(o.name)}</strong><a class="back" href="${esc(o.homeHref)}" target="_top">← Back to home</a></div></nav>
<main class="wrap">
  <header class="top">
    <span class="eyebrow rise">${esc(o.name)}</span>
    <h1 class="rise">${esc(o.heading)}</h1>
    ${intro}
  </header>
  <ol class="progress" id="progress" aria-label="Booking steps"></ol>
  <div class="layout">
    <section class="panel" id="panel" aria-live="polite"><div class="skeleton"></div></section>
    <aside class="summary" id="summary" aria-label="Your booking"><h3>Your booking</h3><p class="empty">Pick what you want to book to see it here.</p></aside>
  </div>
</main>
<script>
(function () {
  var FORM = ${JSON.stringify(o.formId)};
  var HOME = ${JSON.stringify(o.homeHref)};
  var TZ = "Asia/Manila";
  var panel = document.getElementById("panel");
  var summary = document.getElementById("summary");
  var progress = document.getElementById("progress");
  var form = null, steps = [], at = 0, quoting = 0;
  var state = { resource: "", day: "", slots: [], slotsFor: "", from: "", to: "", stay: { start: "", end: "" }, days: [],
    month: 0, extras: {}, values: {}, payment: "", quote: null, sending: false, errors: {}, message: "" };

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === "text") n.textContent = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function dayKey(d) { return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }
  function fromKey(k) { return new Date(k + "T12:00:00+08:00"); }
  function addDays(k, n) { return dayKey(new Date(fromKey(k).getTime() + n * 86400000)); }
  function fmt(d, opts) { return new Intl.DateTimeFormat("en-PH", Object.assign({ timeZone: TZ }, opts)).format(d); }
  function timeOf(iso) { return fmt(new Date(iso), { hour: "numeric", minute: "2-digit" }); }
  function dayLabel(k) { return fmt(fromKey(k), { weekday: "short", month: "short", day: "numeric" }); }
  function booking() { return form && form.booking; }
  function payField() {
    if (!form || !form.payments) return null;
    var ids = form.payments.items.map(function (i) { return i.id; });
    return form.fields.find(function (f) {
      return f.type === "relation" && (form.choices[f.id] || []).some(function (c) { return ids.indexOf(c.id) >= 0; });
    }) || null;
  }
  function askedFields() {
    var b = booking() || {}, pf = payField();
    var skip = [b.resourceFieldId, b.timeFieldId].concat(b.dayFieldIds || [], b.endDayFieldIds || [], pf ? [pf.id] : []);
    return form.fields.filter(function (f) { return skip.indexOf(f.id) < 0; });
  }
  // A payment reference or a receipt picture is asked with the payment methods, once the visitor knows where to pay.
  function isPayDetail(f) { return /pay|reference|receipt|proof|transaction/i.test(f.id + " " + f.name); }
  function hasPayStep() { return !!(payField() || form.payments); }
  function detailFields() { return askedFields().filter(function (f) { return !(hasPayStep() && isPayDetail(f)); }); }
  function payFields() { return hasPayStep() ? askedFields().filter(isPayDetail) : []; }
  function resourceTitle() {
    var r = (booking().resources || []).find(function (x) { return x.id === state.resource; });
    return r ? r.title : "";
  }
  function picked() {
    var b = booking();
    if (!b) return null;
    if (b.dates) return state.stay.start && state.stay.end ? { start: state.stay.start, end: state.stay.end } : null;
    if (!state.from) return null;
    var a = state.slots.findIndex(function (s) { return s.start === state.from; });
    var z = state.slots.findIndex(function (s) { return s.start === (state.to || state.from); });
    if (a < 0 || z < 0) return null;
    return { start: state.slots[Math.min(a, z)].start, end: state.slots[Math.max(a, z)].end };
  }
  function rawValues() {
    var out = {}, b = booking(), range = picked(), pf = payField();
    for (var k in state.values) out[k] = state.values[k];
    if (b && state.resource) out[b.resourceFieldId] = state.resource;
    if (b && range) { out[b.timeFieldId + "_start"] = range.start; out[b.timeFieldId + "_end"] = range.end; }
    if (pf && state.payment) out[pf.id] = state.payment;
    return out;
  }

  function buildSteps() {
    var b = booking();
    steps = b ? [{ id: "when", title: b.dates ? "Dates" : "Date & time" }] : [];
    if (form.extras && form.extras.items.length) steps.push({ id: "extras", title: form.extras.title || "Add-ons" });
    if (detailFields().length) steps.push({ id: "details", title: "Your details" });
    if (hasPayStep()) steps.push({ id: "pay", title: "Payment" });
    steps.push({ id: "review", title: "Review" });
  }
  function drawProgress() {
    progress.innerHTML = "";
    steps.forEach(function (s, i) {
      progress.appendChild(el("li", { "aria-current": i === at ? "step" : null, class: i < at ? "done" : null },
        [el("span", { text: i < at ? "\u2713" : String(i + 1) }), s.title]));
    });
  }
  function drawSummary() {
    var rows = [], b = booking(), range = picked(), pf = payField();
    if (b && state.resource) rows.push(["Booking", resourceTitle()]);
    if (range && b.dates) rows.push(["Stay", dayLabel(range.start) + " \u2013 " + dayLabel(range.end)]);
    else if (range) rows.push(["When", dayLabel(state.day) + ", " + timeOf(range.start) + " \u2013 " + timeOf(range.end)]);
    (form.extras ? form.extras.items : []).forEach(function (i) {
      if (state.extras[i.id]) rows.push([i.title, "\u00d7 " + state.extras[i.id]]);
    });
    if (pf && state.payment) {
      var c = (form.choices[pf.id] || []).find(function (x) { return x.id === state.payment; });
      if (c) rows.push(["Pay with", c.title]);
    }
    summary.innerHTML = "";
    summary.appendChild(el("h3", { text: "Your booking" }));
    if (!rows.length) { summary.appendChild(el("p", { class: "empty", text: "Pick what you want to book to see it here." })); return; }
    var dl = el("dl");
    rows.forEach(function (r) { dl.appendChild(el("div", {}, [el("dt", { text: r[0] }), el("dd", { text: r[1] })])); });
    (state.quote || []).forEach(function (l, i, all) {
      dl.appendChild(el("div", { class: i === all.length - 1 ? "total" : null }, [el("dt", { text: l.name }), el("dd", { text: l.text })]));
    });
    summary.appendChild(dl);
  }
  function requote() {
    if (booking() && !picked()) { state.quote = null; drawSummary(); return; }
    var mine = ++quoting;
    EveryOps.quote(FORM, rawValues(), state.extras).then(function (r) {
      if (mine !== quoting) return;
      state.quote = r && r.ok ? r.lines : null;
      drawSummary();
    });
  }
  function chooser(items, current, onPick) {
    return el("div", { class: "choices" }, items.map(function (it) {
      return el("button", { type: "button", class: "choice", "aria-pressed": String(it.id === current), onclick: function () { onPick(it.id); } },
        [el("strong", { text: it.title }), it.note ? el("small", { text: it.note }) : null]);
    }));
  }
  function loadSlots() {
    state.slots = []; state.from = ""; state.to = ""; state.slotsFor = "";
    draw();
    if (!state.resource || !state.day) return;
    var key = state.resource + state.day;
    EveryOps.slots(FORM, state.resource, state.day).then(function (r) {
      if (key !== state.resource + state.day) return;
      state.slots = r && r.ok ? r.slots : [];
      state.slotsFor = key;
      draw();
    });
  }
  function loadDays() {
    state.days = []; state.month = 0;
    draw();
    if (!state.resource) return;
    var key = state.resource;
    EveryOps.days(FORM, state.resource, dayKey(new Date()), 92).then(function (r) {
      if (key !== state.resource) return;
      state.days = r && r.ok ? r.days : [];
      draw();
    });
  }

  function whenStep(box) {
    var b = booking();
    var resources = b.resources.map(function (r) {
      return { id: r.id, title: r.title, note: b.dates ? "" : "Open " + r.opensAt + " \u2013 " + r.closesAt };
    });
    if (resources.length > 1 || !state.resource) {
      box.appendChild(el("p", { class: "label", text: "Choose one" }));
      box.appendChild(chooser(resources, state.resource, function (id) {
        state.resource = id; state.stay = { start: "", end: "" };
        if (b.dates) loadDays(); else loadSlots();
        requote();
      }));
    }
    if (!state.resource) return;
    if (b.dates) return stayPicker(box);
    box.appendChild(el("p", { class: "label", text: "Pick a day" }));
    var today = dayKey(new Date()), strip = el("div", { class: "days" });
    for (var i = 0; i < 21; i++) (function (k) {
      var d = fromKey(k);
      strip.appendChild(el("button", { type: "button", class: "day", "aria-pressed": String(k === state.day), "aria-label": dayLabel(k), onclick: function () { state.day = k; loadSlots(); } },
        [el("small", { text: fmt(d, { weekday: "short" }) }), el("b", { text: fmt(d, { day: "numeric" }) }), el("small", { text: fmt(d, { month: "short" }) })]));
    })(addDays(today, i));
    box.appendChild(strip);
    if (!state.day) return;
    box.appendChild(el("p", { class: "label", text: b.multiple ? "Pick a start time. For a longer booking, then pick the last hour." : "Pick a time" }));
    if (state.slotsFor !== state.resource + state.day) { box.appendChild(el("div", { class: "skeleton" })); return; }
    if (!state.slots.length) { box.appendChild(el("p", { class: "muted", text: "No open times that day. Try another day." })); return; }
    var range = picked();
    box.appendChild(el("div", { class: "times" }, state.slots.map(function (s) {
      var on = range && s.start >= range.start && s.end <= range.end;
      return el("button", { type: "button", class: "time", disabled: !s.free, "aria-pressed": String(!!on), onclick: function () { pickSlot(s); } }, [timeOf(s.start)]);
    })));
  }
  function pickSlot(s) {
    if (!booking().multiple || !state.from || state.to) { state.from = s.start; state.to = ""; }
    else {
      var a = state.slots.findIndex(function (x) { return x.start === state.from; });
      var z = state.slots.findIndex(function (x) { return x.start === s.start; });
      var lo = Math.min(a, z), hi = Math.max(a, z), ok = a !== z;
      for (var i = lo; i <= hi; i++) if (!state.slots[i].free || (i > lo && state.slots[i - 1].end !== state.slots[i].start)) ok = false;
      if (ok) state.to = s.start; else { state.from = s.start; state.to = ""; }
    }
    state.message = "";
    draw(); requote();
  }
  function stayPicker(box) {
    box.appendChild(el("p", { class: "label", text: "Pick your check-in, then your check-out" }));
    if (!state.days.length) { box.appendChild(el("div", { class: "skeleton" })); return; }
    var free = {};
    state.days.forEach(function (d) { free[d.day] = d.free; });
    var first = fromKey(state.days[0].day.slice(0, 7) + "-15");
    var shown = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + state.month, 15, 4));
    var monthKey = dayKey(shown).slice(0, 7);
    box.appendChild(el("div", { class: "monthbar" }, [
      el("button", { type: "button", "aria-label": "Previous month", disabled: state.month === 0, onclick: function () { state.month--; draw(); } }, ["\u2039"]),
      el("span", { text: fmt(shown, { month: "long", year: "numeric" }) }),
      el("button", { type: "button", "aria-label": "Next month", disabled: state.month >= 2, onclick: function () { state.month++; draw(); } }, ["\u203a"])
    ]));
    var grid = el("div", { class: "month" });
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach(function (d) { grid.appendChild(el("span", { class: "dow", text: d })); });
    var pad = fromKey(monthKey + "-01").getUTCDay();
    for (var i = 0; i < pad; i++) grid.appendChild(el("span"));
    for (var d = 1; d <= 31; d++) {
      var k = monthKey + "-" + (d < 10 ? "0" + d : d);
      if (dayKey(fromKey(k)).slice(0, 7) !== monthKey) break;
      (function (k) {
        var s = state.stay, inRange = s.start && s.end && k > s.start && k < s.end, edge = k === s.start || k === s.end;
        var usable = k in free && (free[k] || (s.start && !s.end && k > s.start));
        grid.appendChild(el("button", { type: "button", class: edge ? "edge" : inRange ? "in" : null, disabled: !usable, "aria-label": dayLabel(k), onclick: function () { pickDay(k, free); } }, [String(Number(k.slice(8)))]));
      })(k);
    }
    box.appendChild(grid);
  }
  function pickDay(k, free) {
    var s = state.stay;
    if (!s.start || s.end || k <= s.start) state.stay = { start: k, end: "" };
    else {
      for (var d = s.start; d < k; d = addDays(d, 1)) if (!free[d]) { state.stay = { start: k, end: "" }; draw(); return; }
      state.stay = { start: s.start, end: k };
    }
    state.message = "";
    draw(); requote();
  }
  function extrasStep(box) {
    form.extras.items.forEach(function (i) {
      var n = state.extras[i.id] || 0;
      box.appendChild(el("div", { class: "addon" }, [
        el("div", {}, [el("strong", { text: i.title }), i.priceText ? el("small", { text: i.priceText + " each" }) : null]),
        el("div", { class: "qty" }, [
          el("button", { type: "button", "aria-label": "Fewer " + i.title, onclick: function () { state.extras[i.id] = Math.max(0, n - 1); draw(); requote(); } }, ["\u2212"]),
          el("output", { text: String(n) }),
          el("button", { type: "button", "aria-label": "More " + i.title, onclick: function () { state.extras[i.id] = Math.min(99, n + 1); draw(); requote(); } }, ["+"])
        ])
      ]));
    });
  }
  function input(f) {
    var v = state.values[f.id];
    var set = function (x) { state.values[f.id] = x; delete state.errors[f.id]; };
    var common = { id: "f_" + f.id, name: f.id, required: f.required || null };
    var on = function (e) { set(e.target.type === "checkbox" ? (e.target.checked ? "on" : "") : e.target.value); };
    switch (f.type) {
      case "long_text": return el("textarea", Object.assign({ rows: "3", oninput: on }, common), [v || ""]);
      case "number": case "money": case "percent": return el("input", Object.assign({ type: "number", step: "any", value: v || "", oninput: on }, common));
      case "rating": return el("select", Object.assign({ value: v || "", onchange: on }, common), [el("option", { value: "" }, ["Choose…"])].concat([5, 4, 3, 2, 1].map(function (n) { return el("option", { value: String(n), selected: String(n) === String(v) || null }, ["★★★★★".slice(0, n) + "☆☆☆☆☆".slice(n)]); })));
      case "duration": return el("input", Object.assign({ type: "text", placeholder: "1:30, 90 or 1h 30m", value: v || "", oninput: on }, common));
      case "date": return el("input", Object.assign({ type: "date", value: v || "", oninput: on }, common));
      case "datetime": return el("input", Object.assign({ type: "datetime-local", value: v || "", oninput: on }, common));
      case "checkbox": return el("input", Object.assign({ type: "checkbox", checked: v === "on" || null, onchange: on }, common));
      case "select": case "status": case "relation": {
        var opts = f.type === "relation" ? (form.choices[f.id] || []).map(function (c) { return { id: c.id, label: c.title }; }) : (f.options || []);
        return el("select", Object.assign({ onchange: on }, common), [el("option", { value: "", text: "Choose\u2026" })].concat(opts.map(function (o) {
          return el("option", { value: o.id, selected: o.id === v || null, text: o.label });
        })));
      }
      case "multi_select": {
        var list = Array.isArray(v) ? v : [];
        return el("div", { class: "choices", id: "f_" + f.id }, (f.options || []).map(function (o) {
          var onNow = list.indexOf(o.id) >= 0;
          return el("button", { type: "button", class: "choice", "aria-pressed": String(onNow), onclick: function () {
            set(onNow ? list.filter(function (x) { return x !== o.id; }) : list.concat(o.id)); draw();
          } }, [o.label]);
        }));
      }
      case "signature": {
        // Once saved, the page says so (the drawing is the team's); a redraw of the panel never loses it.
        if (v) return el("div", { class: "signed", id: "f_" + f.id }, [el("span", { text: "\u2713 Signed" }), el("button", { type: "button", class: "button", onclick: function () { set(""); draw(); } }, ["Sign again"])]);
        var pad = el("canvas", { class: "sign", id: "f_" + f.id, role: "img", "aria-label": "Signature pad for " + f.name + ". Draw your signature with a finger, pen or mouse." });
        var note = el("p", { class: "hint", text: "Sign in the box." });
        var ink = false, lastPt = null;
        var pt = function (e) { var b = pad.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
        requestAnimationFrame(function () {
          var r = window.devicePixelRatio || 1, b = pad.getBoundingClientRect();
          pad.width = Math.round(b.width * r); pad.height = Math.round(b.height * r);
          var c = pad.getContext("2d"); c.scale(r, r); c.lineWidth = 2.2; c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = "#111";
        });
        pad.addEventListener("pointerdown", function (e) { pad.setPointerCapture(e.pointerId); ink = true; lastPt = pt(e); });
        pad.addEventListener("pointermove", function (e) {
          if (!ink || !lastPt) return;
          var c = pad.getContext("2d"), n = pt(e);
          c.beginPath(); c.moveTo(lastPt.x, lastPt.y); c.lineTo(n.x, n.y); c.stroke(); lastPt = n;
        });
        var end = function () {
          if (!ink) return;
          ink = false; lastPt = null; note.textContent = "Saving signature\u2026";
          pad.toBlob(function (blob) {
            if (!blob) return;
            EveryOps.upload(FORM, new File([blob], "Signature.png", { type: "image/png" })).then(function (r) {
              if (r && r.ok) { state.values[f.id] = r.url; delete state.errors[f.id]; note.textContent = "Signed. Keep drawing to change it."; }
              else note.textContent = (r && r.message) || "That didn't save. Sign again.";
            });
          }, "image/png");
        };
        ["pointerup", "pointercancel", "pointerleave"].forEach(function (t) { pad.addEventListener(t, end); });
        return el("div", {}, [pad, note]);
      }
      case "image": return el("input", Object.assign({}, common, { type: "file", accept: "image/*", required: f.required && !v ? true : null, onchange: function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        state.errors[f.id] = "Uploading\u2026"; draw();
        EveryOps.upload(FORM, file).then(function (r) {
          if (r && r.ok) { set(r.url); } else state.errors[f.id] = (r && r.message) || "That upload didn't work.";
          draw();
        });
      } }));
      default: {
        var t = f.type === "email" || /email/i.test(f.name) ? "email" : f.type === "phone" || /phone|mobile/i.test(f.name) ? "tel" : f.type === "url" ? "url" : "text";
        return el("input", Object.assign({ type: t, value: v || "", autocomplete: t === "tel" ? "tel" : t === "email" ? "email" : /name/i.test(f.name) ? "name" : null, oninput: on }, common));
      }
    }
  }
  function fieldRows(box, fields) {
    var wrap = el("div", { class: "fields" });
    fields.forEach(function (f) {
      var label = [el("span", {}, [f.name, f.required ? el("span", { class: "req", text: " *" }) : null])];
      var row = f.type === "checkbox"
        ? el("label", { class: "field check" }, [input(f)].concat(label))
        : el(f.type === "multi_select" ? "div" : "label", { class: "field" }, label.concat([f.description ? el("small", { text: f.description }) : null, input(f)]));
      if (f.type === "image" && state.values[f.id]) row.appendChild(el("small", { text: "Picture added." }));
      if (state.errors[f.id]) row.appendChild(el("span", { class: "error", text: state.errors[f.id] }));
      wrap.appendChild(row);
    });
    box.appendChild(wrap);
  }
  function detailsStep(box) { fieldRows(box, detailFields()); }
  function payStep(box) {
    var pf = payField(), items = form.payments ? form.payments.items : [];
    var list = el("div", { class: "pay" });
    var choices = pf ? (form.choices[pf.id] || []) : items.map(function (i) { return { id: i.id, title: (i.cells.find(function (c) { return c.kind !== "image" && c.text; }) || {}).text || "" }; });
    choices.forEach(function (c) {
      var item = items.find(function (i) { return i.id === c.id; });
      var cells = item ? item.cells : [];
      var img = cells.find(function (x) { return x.kind === "image" && x.text; });
      var rest = cells.filter(function (x) { return x.kind !== "image" && x.text && x.text !== c.title; });
      var body = el("div", {}, [el("strong", { text: c.title }), rest.length ? el("dl", {}, rest.map(function (x) {
        return el("div", {}, [el("dt", { text: x.name }), el("dd", { text: x.text })]);
      })) : null]);
      var pic = img ? el("img", { src: img.text, alt: "QR code for " + c.title, loading: "lazy" }) : null;
      list.appendChild(pf
        ? el("button", { type: "button", class: "choice", "aria-pressed": String(state.payment === c.id), onclick: function () { state.payment = c.id; delete state.errors.pay; state.message = ""; draw(); } }, [pic, body])
        : el("div", { class: "choice" }, [pic, body]));
    });
    box.appendChild(list);
    if (payFields().length) { box.appendChild(el("p", { class: "label", text: "After you pay" })); fieldRows(box, payFields()); }
  }
  function reviewStep(box) {
    var dl = el("dl", { class: "fields" });
    askedFields().forEach(function (f) {
      var v = state.values[f.id];
      if (!v || (Array.isArray(v) && !v.length)) return;
      var label = function (id) { var o = (f.options || []).find(function (x) { return x.id === id; }); return o ? o.label : id; };
      var shown = Array.isArray(v) ? v.map(label).join(", ")
        : f.type === "relation" ? ((form.choices[f.id] || []).find(function (c) { return c.id === v; }) || { title: v }).title
        : f.options ? label(v) : f.type === "image" ? "Picture added" : f.type === "checkbox" ? "Yes" : String(v);
      dl.appendChild(el("div", { class: "field" }, [el("small", { text: f.name }), el("span", { text: shown })]));
    });
    box.appendChild(dl);
    box.appendChild(el("p", { class: "muted", text: "Check your booking, then confirm. You'll get a reference number right away." }));
  }
  function problem() {
    var s = steps[at].id, b = booking(), pf = payField();
    if (s === "when") {
      if (!state.resource) return "Choose what you'd like to book.";
      if (!picked()) return b.dates ? "Pick your check-in and check-out dates." : "Pick a day and a time.";
    }
    if (s === "details" || s === "pay") {
      var fields = s === "details" ? detailFields() : payFields();
      if (s === "pay" && pf && pf.required && !state.payment) return "Choose how you'll pay.";
      var missing = fields.filter(function (f) { var v = state.values[f.id]; return f.required && (!v || (Array.isArray(v) && !v.length)); });
      missing.forEach(function (f) { state.errors[f.id] = "Please fill this in."; });
      if (missing.length) return "A few details are missing.";
      var bad = fields.find(function (f) { var n = document.getElementById("f_" + f.id); return n && n.checkValidity && !n.checkValidity(); });
      if (bad) { state.errors[bad.id] = "Please check this."; return "Please check your details."; }
    }
    return "";
  }
  var HINTS = { extras: "Add anything you'd like ready when you arrive.", details: "So we know who's coming and how to reach you.", review: "One last look before you confirm." };
  function draw() {
    if (!form) return;
    drawProgress();
    var s = steps[at], last = at === steps.length - 1, b = booking();
    var hint = s.id === "when" ? (b.dates ? "Free dates can be picked. Taken ones are crossed out." : "Only open times are shown. Taken ones are crossed out.")
      : s.id === "pay" ? (payField() ? "Choose how you'll pay. Scan the QR code or send to the account shown." : "Here's how to pay.") : HINTS[s.id];
    var box = el("div", { class: "step", "data-step": s.id }, [el("h2", { text: s.title }), el("p", { class: "hint", text: hint })]);
    ({ when: whenStep, extras: extrasStep, details: detailsStep, pay: payStep, review: reviewStep })[s.id](box);
    if (state.message) box.appendChild(el("p", { class: "notice error", role: "alert", text: state.message }));
    box.appendChild(el("div", { class: "actions" }, [
      at > 0 ? el("button", { type: "button", class: "button", onclick: function () { state.message = ""; at--; draw(); } }, ["Back"])
        : el("a", { class: "button", href: HOME, target: "_top" }, ["Cancel"]),
      el("button", { type: "button", class: "button primary", disabled: state.sending || null, onclick: last ? send : next },
        [last ? (state.sending ? "Sending\u2026" : form.submitLabel || "Confirm booking") : "Continue"])
    ]));
    // Keep the step's entrance to real step changes, not every redraw inside a step.
    if (panel.getAttribute("data-at") === String(at)) box.style.animation = "none";
    panel.setAttribute("data-at", String(at));
    panel.innerHTML = "";
    panel.appendChild(box);
    drawSummary();
  }
  function next() {
    var why = problem();
    state.message = why;
    if (!why) { at++; requote(); }
    draw();
    if (!why) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function send() {
    state.sending = true; state.message = ""; draw();
    EveryOps.submit(FORM, rawValues(), state.extras).then(function (r) {
      state.sending = false;
      if (r && r.ok) return done(r);
      state.message = (r && r.message) || "Something went wrong. Please try again.";
      ((r && r.fieldErrors) || []).forEach(function (e) { if (e.fieldId) state.errors[e.fieldId] = e.message; });
      draw();
    });
  }
  function done(r) {
    progress.innerHTML = "";
    summary.style.display = "none";
    panel.innerHTML = "";
    panel.appendChild(el("div", { class: "done" }, [
      el("div", { class: "tick", "aria-hidden": "true", text: "\u2713" }),
      el("h2", { text: "You're booked!" }),
      el("p", { class: "muted", text: "Your reference is " + r.reference + ". Keep it for when you arrive." }),
      el("dl", {}, (r.summary || []).map(function (l) { return el("div", {}, [el("dt", { text: l.name }), el("dd", { text: l.text })]); })),
      r.manage ? el("p", { class: "muted" }, [el("a", { href: r.manage, target: "_top" }, ["View or update your booking"]), " (keep this link to send a proof of payment later)"]) : el("span", {}),
      el("a", { class: "button primary", href: HOME, target: "_top" }, ["Back to home"])
    ]));
  }

  if (!window.EveryOps || !EveryOps.form) { panel.innerHTML = '<p class="muted">Open this page from its booking link to book.</p>'; return; }
  EveryOps.form(FORM).then(function (r) {
    if (!r || !r.ok) { panel.innerHTML = '<p class="muted">Booking is closed right now. Please check back soon.</p>'; return; }
    form = r.form;
    var b = booking();
    if (b && b.resources.length === 1) state.resource = b.resources[0].id;
    buildSteps();
    draw();
    if (b && state.resource && b.dates) loadDays();
  });
})();
</script>
</body>
</html>
`;
}
