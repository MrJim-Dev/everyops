/**
 * Custom HTML pages: a whole page the owner designs (a landing page, a booking or sign-up form, instructions) shown
 * in a sandboxed frame. Scripts may run, but in an opaque origin with no access to the app, its cookies or the page
 * around it. The only way out is a small message bridge: a <form data-everyops-form="formViewId"> (or
 * EveryOps.submit(formViewId, values)) sends its values to one of the workspace's public forms, which checks them
 * exactly like its own form does.
 */
import type { Blueprint, FieldValue, HtmlPageView } from "@/lib/blueprint/types";
import { at } from "@/lib/time";
import type { PublicField, PublicForm } from "./resolve";

/** Same key format as resolve.ts's docKey (kept here so the two modules don't import each other). */
const docKey = (viewId: string, blockId: string) => `${viewId}:${blockId}`;

/** Biggest page we store (the whole workspace is capped at 4 MB). */
export const MAX_HTML_BYTES = 400_000;

/** What a new page starts with until the owner pastes or uploads their own design. */
export const STARTER_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My page</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; color: #1c1917; background: #fafaf9; }
    header { padding: 72px 24px 48px; text-align: center; background: linear-gradient(180deg, #ecfdf5, #fafaf9); }
    h1 { margin: 0 0 12px; font-size: clamp(32px, 6vw, 56px); letter-spacing: -0.02em; }
    p { margin: 0 auto; max-width: 560px; font-size: 18px; line-height: 1.6; color: #57534e; }
    main { max-width: 960px; margin: 0 auto; padding: 32px 24px 72px; display: grid; gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    .card { background: #fff; border: 1px solid #e7e5e4; border-radius: 16px; padding: 24px; }
    .card h2 { margin: 0 0 8px; font-size: 18px; }
    .card p { font-size: 15px; margin: 0; }
  </style>
</head>
<body>
  <header>
    <h1>Your page, your design</h1>
    <p>Replace this with your own HTML and CSS: paste it here, or upload an .html file.</p>
  </header>
  <main>
    <div class="card"><h2>Anything goes</h2><p>Landing pages, menus, instructions, event pages.</p></div>
    <div class="card"><h2>Connect a form</h2><p>Add data-everyops-form to a form to save what visitors send.</p></div>
    <div class="card"><h2>Publish it</h2><p>Make it public to get a link you can share.</p></div>
  </main>
</body>
</html>
`;

/** The page's HTML: what the team saved, else what it was created with, else the starter. */
export function pageHtml(view: HtmlPageView, docs: Record<string, { body: string } | undefined>): string {
  return docs[view.id]?.body ?? view.html ?? STARTER_HTML;
}

/** Workspace doc keys that hold HTML (pages and HTML blocks). Only owners and admins may change them. */
export function htmlDocKeys(bp: Blueprint): string[] {
  const keys: string[] = [];
  for (const view of bp.views) {
    if (view.type === "html") keys.push(view.id);
    if (view.type === "landing" || view.type === "form")
      for (const block of view.blocks ?? []) if (block.type === "html") keys.push(docKey(view.id, block.id));
  }
  return keys;
}

/** Runs inside the sandboxed page. Kept tiny and dependency-free; it only talks to the page that embeds it. */
const BRIDGE = `(function(){
var waiting={},next=0;
function submit(form,values){return new Promise(function(done){var id=++next;waiting[id]=done;parent.postMessage({everyops:"submit",id:id,form:String(form),values:values||{}},"*");});}
window.addEventListener("message",function(e){var d=e.data;if(e.source!==parent||!d||d.everyops!=="result")return;var done=waiting[d.id];if(done){delete waiting[d.id];done(d.result);}});
window.EveryOps={submit:submit};
document.addEventListener("submit",function(e){var f=e.target,id=f&&f.getAttribute&&f.getAttribute("data-everyops-form");if(!id)return;e.preventDefault();
var values={};new FormData(f).forEach(function(v,k){if(typeof v!=="string")return;if(k in values){values[k]=[].concat(values[k],v);}else values[k]=v;});
var buttons=f.querySelectorAll("button,[type=submit]");buttons.forEach(function(b){b.disabled=true;});f.setAttribute("data-state","sending");
submit(id,values).then(function(r){buttons.forEach(function(b){b.disabled=false;});f.setAttribute("data-state",r&&r.ok?"sent":"error");
var text=r&&r.ok?(f.getAttribute("data-success")||"Thank you! We got it."+(r.reference?" Reference: "+r.reference:"")):((r&&r.message)||"Something went wrong. Please try again.");
var out=f.querySelector("[data-everyops-message]");if(!out){out=document.createElement("p");out.setAttribute("data-everyops-message","");out.setAttribute("role","status");f.appendChild(out);}out.textContent=text;
if(r&&r.ok)f.reset();f.dispatchEvent(new CustomEvent("everyops:result",{detail:r,bubbles:true}));});},true);
document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a||a.target)return;var h=a.getAttribute("href")||"";if(!h||h.charAt(0)==="#"||/^javascript:/i.test(h))return;a.target="_top";},true);
})();`;

/**
 * The document the frame shows: the owner's HTML with the bridge added. A fragment (no <html>) is wrapped in a
 * minimal page so it still renders like a page on phones.
 */
export function frameDocument(html: string): string {
  const script = `<script>${BRIDGE}</script>`;
  if (!/<html[\s>]/i.test(html))
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}${script}</body></html>`;
  const end = html.search(/<\/body>/i);
  if (end >= 0) return html.slice(0, end) + script + html.slice(end);
  return html + script;
}

/** Sandbox for custom pages: scripts, forms (handled by the bridge), new tabs, and links that open in the whole tab
 * when a visitor clicks them. Never allow-same-origin: the page must stay cut off from the app. */
export const HTML_PAGE_SANDBOX =
  "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation";

/** What a custom page's form sends: every input by name; repeated names (checkboxes) become lists. */
export type RawFormValues = Record<string, string | string[]>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
const list = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v : (v ?? "").split(",")).map((x) => x.trim()).filter(Boolean);
/** "2026-10-20T18:00" (a datetime-local input) as an ISO instant in Manila. */
const manila = (local: string) => {
  const [day, time] = local.split("T");
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && /^\d{2}:\d{2}/.test(time ?? "") ? at(day, time.slice(0, 5)) : "";
};

/**
 * Turns a custom page's form into the values a public form takes: inputs named after the form's field ids, choices
 * by id or label, numbers as numbers, checkboxes as true, and time ranges from "<field>_start" and "<field>_end".
 * Anything the form doesn't ask for is dropped; the server checks the rest exactly like its own form.
 */
export function formValues(form: PublicForm, raw: RawFormValues): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  const pick = (field: PublicField, v: string) =>
    field.options?.find((o) => o.id === v || o.label.toLowerCase() === v.toLowerCase())?.id;
  for (const f of form.fields) {
    const v = first(raw[f.id]);
    switch (f.type) {
      case "number":
      case "money":
      case "percent": {
        const n = Number(v.replace(/[₱,\s]/g, ""));
        if (v && Number.isFinite(n)) out[f.id] = n;
        break;
      }
      case "checkbox":
        if (raw[f.id] !== undefined) out[f.id] = /^(on|true|yes|1)$/i.test(v);
        break;
      case "select":
      case "status": {
        const id = v ? pick(f, v) : undefined;
        if (id) out[f.id] = id;
        break;
      }
      case "multi_select": {
        const ids = list(raw[f.id])
          .map((x) => pick(f, x))
          .filter((x): x is string => !!x);
        if (ids.length) out[f.id] = ids;
        break;
      }
      case "relation": {
        const choice = form.choices[f.id]?.find(
          (c) => c.id === v || c.title.toLowerCase() === v.toLowerCase(),
        );
        if (choice) out[f.id] = choice.id;
        break;
      }
      case "datetime":
        if (v) out[f.id] = manila(v) || v;
        break;
      case "time_range": {
        const start = first(raw[`${f.id}_start`]);
        const end = first(raw[`${f.id}_end`]);
        if (!start || !end) break;
        out[f.id] =
          f.range === "dates" ? { start, end } : { start: manila(start) || start, end: manila(end) || end };
        break;
      }
      default:
        if (v) out[f.id] = v;
    }
  }
  return out;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** A ready-to-style HTML form for one of the workspace's public forms, with inputs named after its fields. */
export function formSnippet(form: PublicForm): string {
  const rows = form.fields.map((f) => {
    const req = f.required ? " required" : "";
    const label = esc(f.name);
    const options = (items: { id: string; label: string }[]) =>
      items.map((o) => `      <option value="${esc(o.id)}">${esc(o.label)}</option>`).join("\n");
    switch (f.type) {
      case "long_text":
        return `  <label>${label}<textarea name="${f.id}" rows="4"${req}></textarea></label>`;
      case "number":
      case "money":
      case "percent":
        return `  <label>${label}<input type="number" name="${f.id}" step="any"${req}></label>`;
      case "date":
        return `  <label>${label}<input type="date" name="${f.id}"${req}></label>`;
      case "datetime":
        return `  <label>${label}<input type="datetime-local" name="${f.id}"${req}></label>`;
      case "checkbox":
        return `  <label><input type="checkbox" name="${f.id}"> ${label}</label>`;
      case "time_range": {
        const type = f.range === "dates" ? "date" : "datetime-local";
        return `  <label>${label} from<input type="${type}" name="${f.id}_start"${req}></label>\n  <label>${label} until<input type="${type}" name="${f.id}_end"${req}></label>`;
      }
      case "select":
      case "status":
        return `  <label>${label}<select name="${f.id}"${req}>\n      <option value="">Choose…</option>\n${options(f.options ?? [])}\n    </select></label>`;
      case "multi_select":
        return (f.options ?? [])
          .map(
            (o) =>
              `  <label><input type="checkbox" name="${f.id}" value="${esc(o.id)}"> ${esc(o.label)}</label>`,
          )
          .join("\n");
      case "relation":
        return `  <label>${label}<select name="${f.id}"${req}>\n      <option value="">Choose…</option>\n${options((form.choices[f.id] ?? []).map((c) => ({ id: c.id, label: c.title })))}\n    </select></label>`;
      default: {
        const type = /email/i.test(f.name) ? "email" : /phone|mobile/i.test(f.name) ? "tel" : "text";
        return `  <label>${label}<input type="${type}" name="${f.id}"${req}></label>`;
      }
    }
  });
  return `<form data-everyops-form="${form.viewId}" data-success="Thank you! We'll be in touch.">
${rows.join("\n")}
  <button type="submit">${esc(form.submitLabel)}</button>
  <p data-everyops-message></p>
</form>`;
}
