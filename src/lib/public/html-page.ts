/**
 * Custom HTML pages: a whole page the owner designs (a landing page, a booking or sign-up form, instructions) shown
 * in a sandboxed frame. Scripts may run, but in an opaque origin with no access to the app, its cookies or the page
 * around it. The only way out is a small message bridge: a <form data-everyops-form="formViewId"> (or
 * EveryOps.submit(formViewId, values, extras)) sends its values to one of the workspace's public forms, which checks
 * them exactly like its own form does. A custom booking page also reads through it: EveryOps.form(id) (fields,
 * courts or rooms, add-ons and payment methods), EveryOps.slots(id, resource, day), EveryOps.days(id, resource, from,
 * count), EveryOps.quote(id, values, extras) and EveryOps.upload(id, file), all answered by the page around it.
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
function call(method,form,args){return new Promise(function(done){var id=++next;waiting[id]=done;parent.postMessage({everyops:"call",id:id,method:method,form:String(form),args:args||{}},"*");});}
function submit(form,values,extras){return new Promise(function(done){var id=++next;waiting[id]=done;parent.postMessage({everyops:"submit",id:id,form:String(form),values:values||{},extras:extras||{}},"*");});}
window.addEventListener("message",function(e){var d=e.data;if(e.source!==parent||!d)return;if(d.everyops==="pick"){pick(!!d.on);return;}if(d.everyops!=="result")return;var done=waiting[d.id];if(done){delete waiting[d.id];done(d.result);}});
window.EveryOps={submit:submit,
form:function(f){return call("form",f);},
slots:function(f,resource,day){return call("slots",f,{resource:resource,date:day});},
days:function(f,resource,from,count){return call("days",f,{resource:resource,from:from,count:count||42});},
quote:function(f,values,extras){return call("quote",f,{values:values||{},extras:extras||{}});},
upload:function(f,file){return call("upload",f,{file:file});}};
var picking=false,hovered=null,mark=document.createElement("div");
mark.setAttribute("aria-hidden","true");mark.style.cssText="position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #34c3a6;background:rgba(52,195,166,.12);border-radius:4px;display:none";
function flat(t,n){return String(t||"").replace(/\\s+/g," ").trim().slice(0,n);}
function pickable(t){for(var at=t;at&&at.nodeType===1&&at!==document.body&&at!==document.documentElement;at=at.parentElement){if(at.matches("a,button,input,select,textarea,img,h1,h2,h3,h4,li,tr,label"))return at;var r=at.getBoundingClientRect();if(r.width*r.height>=1600&&!(at instanceof SVGElement))return at;}return null;}
function show(el){hovered=el;if(!el){mark.style.display="none";return;}var r=el.getBoundingClientRect();if(!mark.isConnected)document.documentElement.appendChild(mark);mark.style.display="block";mark.style.left=r.left+"px";mark.style.top=r.top+"px";mark.style.width=r.width+"px";mark.style.height=r.height+"px";}
function where(el){var names=[];for(var at=el.parentElement;at&&at!==document.body&&names.length<3;at=at.parentElement){var h=at.querySelector(":scope>h1,:scope>h2,:scope>h3,:scope>header h1,:scope>header h2");var n=flat(at.getAttribute("aria-label")||(h&&h.textContent)||"",60);if(n&&names.indexOf(n)<0)names.unshift(n);}return names.join(" \u203a ");}
function pick(on){picking=on;document.documentElement.style.cursor=on?"crosshair":"";if(!on)show(null);}
function block(e){if(!picking)return;e.preventDefault();e.stopImmediatePropagation();}
["pointerdown","mousedown","pointerup","mouseup","dblclick","submit"].forEach(function(t){window.addEventListener(t,block,true);});
window.addEventListener("pointermove",function(e){if(picking)show(pickable(e.target));},true);
window.addEventListener("scroll",function(){if(picking&&hovered)show(hovered);},true);
window.addEventListener("click",function(e){if(!picking)return;block(e);var el=pickable(e.target);if(!el)return;
parent.postMessage({everyops:"picked",tag:el.tagName.toLowerCase(),label:flat(el.getAttribute("aria-label")||el.getAttribute("alt")||el.textContent,120),text:flat(el.innerText,400),html:flat(el.outerHTML,1500),path:where(el)},"*");},true);
window.addEventListener("keydown",function(e){if(picking&&e.key==="Escape")parent.postMessage({everyops:"pick-cancel"},"*");},true);
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
 * The document the frame shows: the owner's HTML with the bridge added first thing in <head>, so the page's own
 * scripts can call EveryOps as they run (a custom booking page reads its form on load). A fragment (no <html>) is
 * wrapped in a minimal page so it still renders like a page on phones.
 */
export function frameDocument(html: string): string {
  const script = `<script>${BRIDGE}</script>`;
  if (!/<html[\s>]/i.test(html))
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${script}</head><body>${html}</body></html>`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head)
    return html.slice(0, head.index + head[0].length) + script + html.slice(head.index + head[0].length);
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
/**
 * "2026-10-20T18:00" (a datetime-local input) as an ISO instant in Manila. A value that already says its zone (a slot
 * from EveryOps.slots, "…T10:00:00.000Z") is an instant already and is kept as it is.
 */
const manila = (local: string) => {
  if (/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(local))
    return Number.isFinite(Date.parse(local)) ? new Date(local).toISOString() : "";
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
  // A readable starting look the page's own CSS overrides (the selectors have no weight); --everyops-accent colours
  // the buttons.
  const open = `<style>${FORM_CSS}</style>
<form data-everyops-form="${form.viewId}" data-success="Thank you! We'll be in touch.">`;
  const steps = form.steps?.filter((s) => s.fieldIds.length) ?? [];
  if (steps.length < 2)
    return `${open}
${rows.join("\n")}
  <button type="submit">${esc(form.submitLabel)}</button>
  <p data-everyops-message></p>
</form>`;
  // In steps: one fieldset per step, shown one at a time by a few lines of script (pages may run scripts in their
  // sandbox). Each step's fields are checked before Next; fields no step lists go on the last one.
  const rowOf = new Map(form.fields.map((f, i) => [f.id, rows[i]]));
  const placed = new Set(steps.flatMap((s) => s.fieldIds));
  const left = form.fields.filter((f) => !placed.has(f.id)).map((f) => f.id);
  const sets = steps.map((s, i) => {
    const ids = i === steps.length - 1 ? [...s.fieldIds, ...left] : s.fieldIds;
    const body = ids.flatMap((id) => (rowOf.has(id) ? [`  ${rowOf.get(id)}`] : [])).join("\n");
    return `  <fieldset data-step="${i + 1}">\n    <legend>${esc(s.title)}</legend>\n${body}\n  </fieldset>`;
  });
  return `${open}
${sets.join("\n")}
  <div class="everyops-steps-nav">
    <button type="button" data-back>Back</button>
    <button type="button" data-next>Next</button>
    <button type="submit">${esc(form.submitLabel)}</button>
  </div>
  <p data-everyops-message></p>
</form>
<script>${STEP_SCRIPT}</script>`;
}

/** A connected form's starting look: stacked labels, roomy inputs, rounded buttons. */
const FORM_CSS =
  ":where(form[data-everyops-form]){display:grid;gap:18px;max-width:560px;font:inherit;color:inherit}:where(form[data-everyops-form] fieldset){border:0;margin:0;padding:0;display:grid;gap:14px}:where(form[data-everyops-form] legend){padding:0;margin-bottom:4px;font-weight:600;font-size:1.05em}:where(form[data-everyops-form] label){display:grid;gap:6px;font-size:14px;font-weight:500}:where(form[data-everyops-form] label:has(> input[type=checkbox])){display:flex;align-items:center;gap:8px}:where(form[data-everyops-form] input,form[data-everyops-form] select,form[data-everyops-form] textarea){width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid #d6d3d1;border-radius:10px;background:#fff;color:#1c1917}:where(form[data-everyops-form] input[type=checkbox]){width:auto}:where(form[data-everyops-form] button){font:inherit;font-weight:600;padding:11px 20px;border:1px solid transparent;border-radius:10px;background:var(--everyops-accent,#0f766e);color:#fff;cursor:pointer}:where(form[data-everyops-form] button[data-back]){background:transparent;color:inherit;border-color:currentColor}:where(form[data-everyops-form] .everyops-steps-nav){display:flex;gap:8px;justify-content:flex-end}:where(form[data-everyops-form] [data-everyops-message]:empty){display:none}:where(form[data-everyops-form]) [hidden]{display:none!important}";

/** Shows a stepped form's fieldsets one at a time, checking each step's fields before Next. */
const STEP_SCRIPT =
  '(function(){var f=document.currentScript.previousElementSibling,s=f.querySelectorAll("[data-step]"),i=0,b=f.querySelector("[data-back]"),n=f.querySelector("[data-next]"),go=f.querySelector("[type=submit]");function vis(el,on){el.hidden=!on;el.style.display=on?"":"none";}function show(){s.forEach(function(x,k){vis(x,k===i);});vis(b,i>0);vis(n,i<s.length-1);vis(go,i===s.length-1);}n.addEventListener("click",function(){var ok=true;s[i].querySelectorAll("input,select,textarea").forEach(function(el){if(ok&&!el.reportValidity())ok=false;});if(ok){i++;show();}});b.addEventListener("click",function(){i--;show();});f.addEventListener("everyops:result",function(e){if(e.detail&&e.detail.ok){i=0;show();}});show();})();';
