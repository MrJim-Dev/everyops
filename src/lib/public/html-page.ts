/**
 * Custom HTML pages: a whole page the owner designs (a landing page, a booking or sign-up form, instructions) shown
 * in a sandboxed frame. Scripts may run, but in an opaque origin with no access to the app, its cookies or the page
 * around it. The only way out is a small message bridge: a <form data-everyops-form="formViewId"> (or
 * EveryOps.submit(formViewId, values, extras)) sends its values to one of the workspace's public forms, which checks
 * them exactly like its own form does. A custom booking page also reads through it: EveryOps.form(id) (fields,
 * courts or rooms, add-ons and payment methods), EveryOps.slots(id, resource, day), EveryOps.days(id, resource, from,
 * count), EveryOps.quote(id, values, extras) and EveryOps.upload(id, file), all answered by the page around it.
 * EveryOps.mine() and EveryOps.attach(fieldId, file) read and add a picture to the visitor's own booking when the page
 * was opened from its manage link (?manage=TOKEN, see src/server/manage.ts).
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

/**
 * Data bindings, run inside the sandboxed page after the bridge (see src/lib/public/bindings.ts for the values):
 * <template data-everyops-each="SOURCE" data-everyops-block="PART" data-everyops-limit="6" data-everyops-skip="@title="
 * data-everyops-refresh="30"> repeats its content for each row; data-field / data-everyops-text set text,
 * data-everyops-if / -unless keep an element only when a value is (or isn't) there or equal ("@kind=hours"), {key} in
 * an attribute is replaced (data-src and data-href become src and href), and [data-everyops-state="loading|empty|
 * error"] beside a template shows while it is in that state. data-everyops-record="SOURCE" fills one row (the one in the
 * page's address by default). Outside a row, only site.* and route.* values are read. Values only ever become text or
 * attribute values, never HTML, and URLs that would run script are dropped.
 */
const BINDINGS = `var ctx={site:{},route:{id:"",page:"",query:{}}},lists=0,siteP,routeP,E=window.EveryOps;
E.site=function(){return siteP||(siteP=call("site","site"));};
E.route=function(){return routeP||(routeP=call("route","route"));};
E.items=function(source,block){return call("items",source,{block:block||""});};
E.record=function(source,id){return (id?Promise.resolve(String(id)):E.route().then(function(r){return r&&r.ok?r.id:"";})).then(function(at){if(!at)return {ok:false,missing:true,message:"No record was chosen."};return call("record",source,{id:at});});};
E.watch=function(source,fn,seconds){var stop=false,ms=Math.max(15,Number(seconds)||30)*1000;function run(){if(!stop&&!document.hidden)E.data(source).then(function(r){if(!stop)fn(r);});}function vis(){if(!document.hidden)run();}run();var t=setInterval(run,ms);document.addEventListener("visibilitychange",vis);return function(){stop=true;clearInterval(t);document.removeEventListener("visibilitychange",vis);};};
function get(key,item){key=String(key||"").trim();var v;
if(key.indexOf("site.")===0)v=ctx.site[key.slice(5)];
else if(key.indexOf("route.query.")===0)v=(ctx.route.query||{})[key.slice(12)];
else if(key.indexOf("route.")===0){v=ctx.route[key.slice(6)];if(typeof v==="object")v="";}
else{var f=item&&item.fields||{};v=f[key];if(v==null)v=f[key.toLowerCase()];}
return v==null?"":String(v);}
function global(key){key=String(key||"").trim();return key.indexOf("site.")===0||key.indexOf("route.")===0;}
function test(expr,item){var i=expr.indexOf("!=");if(i>0)return get(expr.slice(0,i),item)!==expr.slice(i+2).trim();i=expr.indexOf("=");if(i>0)return get(expr.slice(0,i),item)===expr.slice(i+1).trim();return get(expr,item)!=="";}
function fill(text,item){return String(text).replace(/\\{([^{}]+)\\}/g,function(w,k){return get(k,item);});}
var URLISH={href:1,src:1,action:1,formaction:1,poster:1};
function setAttr(el,name,value){if(URLISH[name]&&/^\\s*(javascript|vbscript|data:text)/i.test(value))value="#";el.setAttribute(name,value);}
function applyEl(el,item){var own=item!==undefined,x;
x=el.getAttribute("data-everyops-if");if(x!=null&&(own||global(x))&&!test(x,item)){el.remove();return;}
x=el.getAttribute("data-everyops-unless");if(x!=null&&(own||global(x))&&test(x,item)){el.remove();return;}
x=el.getAttribute("data-field");if(x==null)x=el.getAttribute("data-everyops-text");
if(x!=null&&(own||global(x))){var v=get(x,item);if(v||own)el.textContent=v;}
if(!own&&!el.hasAttribute("data-everyops-bind"))return;
var attrs=[].slice.call(el.attributes);for(var i=0;i<attrs.length;i++){var a=attrs[i];
if(a.value.indexOf("{")<0||a.name==="data-field"||a.name.indexOf("data-everyops")===0)continue;
var name=a.name==="data-src"?"src":a.name==="data-href"?"href":a.name;setAttr(el,name,fill(a.value,item));}}
function fillTree(root,item){[].slice.call(root.querySelectorAll("*")).forEach(function(el){if(el.tagName!=="TEMPLATE")applyEl(el,item);});
[].slice.call(root.querySelectorAll("template[data-everyops-each]")).forEach(function(t){var s=t.getAttribute("data-everyops-each")||"";if(s.charAt(0)!=="@")return;var sub=item&&item[s.slice(1)];renderItems(t,{ok:true,items:Array.isArray(sub)?sub:[]});});}
function state(host,s,msg){if(!host)return;host.setAttribute("data-everyops-status",s);[].forEach.call(host.children,function(el){var want=el.getAttribute("data-everyops-state");if(want==null)return;el.hidden=want!==s;if(s==="error"&&want==="error"&&msg&&!el.textContent.trim())el.textContent=msg;});
var box=host.closest("[data-everyops-hide-empty]");if(box)box.hidden=s==="empty"||s==="error";}
function renderItems(tpl,r){var host=tpl.parentNode;if(!host)return;var key=tpl.__eo||(tpl.__eo="l"+(++lists));
[].slice.call(host.querySelectorAll('[data-everyops-item="'+key+'"]')).forEach(function(el){el.remove();});
if(!r||!r.ok){state(host,"error",r&&r.message);return;}
var skip=tpl.getAttribute("data-everyops-skip"),limit=parseInt(tpl.getAttribute("data-everyops-limit"),10)||0,n=0;
(r.items||[]).forEach(function(item){if(limit&&n>=limit)return;if(skip&&test(skip,item))return;n++;
var frag=tpl.content.cloneNode(true);[].slice.call(frag.childNodes).forEach(function(node){if(node.nodeType===3&&!node.textContent.trim())node.remove();else if(node.nodeType===1)node.setAttribute("data-everyops-item",key);});
fillTree(frag,item);host.insertBefore(frag,tpl);});
state(host,n?"ready":"empty");}
function renderList(tpl){var source=tpl.getAttribute("data-everyops-each")||"";if(!tpl.parentNode)return Promise.resolve();
if(!tpl.__eo)state(tpl.parentNode,"loading");
return E.items(source,tpl.getAttribute("data-everyops-block")||"").then(function(r){renderItems(tpl,r);if(tpl.parentNode)return scan(tpl.parentNode);});}
function renderRecord(box){if(box.__eoHtml==null){box.__eoHtml=box.innerHTML;state(box,"loading");}
var at=box.getAttribute("data-everyops-id");
return E.record(box.getAttribute("data-everyops-record")||"",at?fill(at):"").then(function(r){box.innerHTML=box.__eoHtml;
if(!r||!r.ok)return state(box,r&&r.missing?"empty":"error",r&&r.message);
fillTree(box,r.item);state(box,"ready");});}
function every(el,fn){var s=parseInt(el.getAttribute("data-everyops-refresh"),10);if(s>0)setInterval(function(){if(!document.hidden)fn().then(done);},Math.max(15,s)*1000);}
function scan(root){var jobs=[];
[].slice.call(root.querySelectorAll("template[data-everyops-each]")).forEach(function(t){if(t.__eoBound||(t.getAttribute("data-everyops-each")||"").charAt(0)==="@")return;t.__eoBound=true;jobs.push(renderList(t));every(t,function(){return renderList(t);});});
[].slice.call(root.querySelectorAll("[data-everyops-record]")).forEach(function(b){if(b.__eoBound)return;b.__eoBound=true;jobs.push(renderRecord(b));every(b,function(){return renderRecord(b);});});
return Promise.all(jobs);}
function globals(){[].slice.call(document.querySelectorAll("[data-everyops-text],[data-everyops-if],[data-everyops-unless],[data-everyops-bind]")).forEach(function(el){if(!el.closest("[data-everyops-item],[data-everyops-record]"))applyEl(el);});}
function done(){document.dispatchEvent(new CustomEvent("everyops:bound"));}
E.bind=function(){return Promise.all([E.site(),E.route()]).then(function(r){if(r[0]&&r[0].ok)ctx.site=r[0].site||{};if(r[1]&&r[1].ok)ctx.route=r[1];globals();return scan(document);}).then(done);};
function start(){if(document.querySelector("template[data-everyops-each],[data-everyops-record],[data-everyops-text],[data-everyops-if],[data-everyops-unless],[data-everyops-bind]"))E.bind();}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();`;

/** Runs inside the sandboxed page. Kept tiny and dependency-free; it only talks to the page that embeds it. */
const BRIDGE = `(function(){
var waiting={},next=0,ready=false,queued=[],probe;
function ping(){parent.postMessage({everyops:"connect"},"*");}
function request(message){return new Promise(function(done){
var id=++next;message.id=id;
var timer=setTimeout(function(){delete waiting[id];queued=queued.filter(function(m){return m.id!==id;});if(!Object.keys(waiting).length){clearInterval(probe);probe=undefined;}done({ok:false,message:"The request timed out. Please try again."});},30000);
waiting[id]=function(result){clearTimeout(timer);done(result);};
if(ready)parent.postMessage(message,"*");else{queued.push(message);ping();if(!probe)probe=setInterval(ping,100);}
});}
function call(method,form,args){return request({everyops:"call",method:method,form:String(form),args:args||{}});}
function submit(form,values,extras){return request({everyops:"submit",form:String(form),values:values||{},extras:extras||{}});}
window.addEventListener("message",function(e){var d=e.data;if(e.source!==parent||!d)return;
if(d.everyops==="pick"){pick(!!d.on);return;}
if(d.everyops==="ready"){ready=true;clearInterval(probe);probe=undefined;var pending=queued;queued=[];pending.forEach(function(m){if(waiting[m.id])parent.postMessage(m,"*");});return;}
if(d.everyops!=="result")return;var done=waiting[d.id];if(done){delete waiting[d.id];done(d.result);}});
window.EveryOps={submit:submit,
data:function(viewId){return call("data",viewId);},
form:function(f){return call("form",f);},
slots:function(f,resource,day){return call("slots",f,{resource:resource,date:day});},
days:function(f,resource,from,count){return call("days",f,{resource:resource,from:from,count:count||42});},
quote:function(f,values,extras){return call("quote",f,{values:values||{},extras:extras||{}});},
upload:function(f,file){return call("upload",f,{file:file});},
mine:function(token){return call("mine","",{token:token||""});},
attach:function(fieldId,file,token){return call("attach","",{fieldId:fieldId,file:file,token:token||""});}};
var picking=false,hovered=null,mark=null;
function marker(){if(!mark){mark=document.createElement("div");mark.setAttribute("aria-hidden","true");mark.style.cssText="position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #34c3a6;background:rgba(52,195,166,.12);border-radius:4px;display:none";}return mark;}
function flat(t,n){return String(t||"").replace(/\\s+/g," ").trim().slice(0,n);}
function pickable(t){for(var at=t;at&&at.nodeType===1&&at!==document.body&&at!==document.documentElement;at=at.parentElement){if(at.matches("a,button,input,select,textarea,img,h1,h2,h3,h4,li,tr,label"))return at;var r=at.getBoundingClientRect();if(r.width*r.height>=1600&&!(at instanceof SVGElement))return at;}return null;}
function show(el){hovered=el;if(!el){if(mark)mark.style.display="none";return;}var r=el.getBoundingClientRect(),m=marker();if(!m.isConnected)document.documentElement.appendChild(m);m.style.display="block";m.style.left=r.left+"px";m.style.top=r.top+"px";m.style.width=r.width+"px";m.style.height=r.height+"px";}
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
${BINDINGS}
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
  const opening = /<html\b[^>]*>/i.exec(html);
  if (opening) {
    const end = opening.index + opening[0].length;
    return `${html.slice(0, end)}<head>${script}</head>${html.slice(end)}`;
  }
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
      case "signature":
        // Custom pages can't draw signatures yet: point visitors to the standard form for this one.
        return `  <!-- ${label}: signatures are signed on the standard form (${form.viewId}), not on custom pages -->`;
      default: {
        const type =
          f.type === "email" || /email/i.test(f.name)
            ? "email"
            : f.type === "phone" || /phone|mobile/i.test(f.name)
              ? "tel"
              : f.type === "url"
                ? "url"
                : "text";
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
