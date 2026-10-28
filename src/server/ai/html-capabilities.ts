/** Shared contract for setup and edits. The runtime implementation lives in public/html-page*. */
export const HTML_CAPABILITIES = `CUSTOM HTML/CSS/JAVASCRIPT PAGES
When the request is for a bespoke/customized page, branded design, interactive experience, or custom form,
prefer a fully coded html view over forcing the design into a layout template. Write the complete responsive
HTML document, including CSS and JavaScript; do not ask the owner to paste code. Keep ordinary record/table
changes in the existing engine. Use the component library and existing pages as references for information
hierarchy, accessible controls, data fields and computed results, not as a limit on the visual design.
The sandbox is vanilla browser HTML/JS: no React imports, internal app imports, npm imports or backend code.
Use the built-in EveryOps bridge (already injected before your scripts), not fetch to guessed endpoints,
localStorage, hardcoded workspace data, invented APIs or secrets. No bridge call can edit/delete arbitrary records.
Every call returns a Promise with ok; on failure show message. Render loading, empty, error and retry states.
Use textContent / DOM nodes for record text, never interpolate untrusted values into innerHTML.

NEVER type records, prices, names, phone numbers or menus into the HTML: they go stale. Show workspace data with
BINDINGS, which the bridge fills from current results every time the page is shown (no script needed):
  <div class="grid"><p data-everyops-state="loading">Loading…</p><p data-everyops-state="empty" hidden>None yet.</p>
    <template data-everyops-each="SOURCE_ID" data-everyops-limit="12"><article>
      <img data-everyops-if="@image" data-src="{@image}" alt=""><h3 data-field="@title"></h3>
      <p data-field="FIELD_ID"></p><a data-href="/s/__everyops_site__/DETAIL_PAGE_ID/{@id}">Details</a>
    </article></template></div>
- data-field / data-everyops-text = a value as text; data-everyops-if / data-everyops-unless keep an element only when
  a value is filled (or equals: "@kind=hours"); {key} inside any attribute is replaced; data-src/data-href become
  src/href. data-everyops-block picks a part of a landing/layout source; data-everyops-skip="@title=" skips rows;
  data-everyops-refresh="30" re-reads every 30 s (availability). Siblings with data-everyops-state show while loading/
  empty/error. Nested <template data-everyops-each="@rows"> (label @name, value @text) or "@tags" lists a row's details.
- Keys: a field id or field name, or roles @id @title @image @about @price @rows @tags @1 @2 (cell order).
- data-everyops-record="SOURCE_ID" fills one row: the record id in the page address /s/site/PAGE/RECORD_ID.
- Site values anywhere: site.name site.phone site.email site.address site.hours site.home site.book site.bookLabel
  (data-everyops-text="site.phone"; add data-everyops-bind to use {site.phone} in an attribute), route.id and
  route.query.NAME. <template data-everyops-each="site.pages"> with data-field="name", data-href="{href}",
  aria-current="{current}" is a menu of the published pages. <div data-everyops-include="HTML_PAGE_ID"></div> inserts
  another (usually team-only) html page, e.g. one shared header or footer used by every page.
- A website setup made also reads its own sections with SOURCE_ID "page" (data-everyops-block: offer, payments, faq,
  hero facts with @kind/@text, contact). Keep its bindings when restyling; change the markup inside templates freely.
- Restyling a page changes markup only; keep every data-everyops-* attribute and template.
JAVASCRIPT (custom behavior only): await EveryOps.data(id), EveryOps.items(id, block) => {ok,items:[{id,fields,rows,tags}]},
EveryOps.record(id, recordId?), EveryOps.site(), EveryOps.route() => {id,query}, EveryOps.watch(id, fn, seconds),
EveryOps.bind() after adding bound markup, and the everyops:bound event after each fill.

DATA: await EveryOps.data("VIEW_ID") reads current results, not a snapshot embedded in the generated source.
- Private HTML pages inside the signed-in workspace may read table views. Result:
  {ok:true,viewId,name,type:"table",columns:[{id,name}],items:[{id,cells:[{fieldId,name,kind,text,value}]}],total,truncated}.
  Only that view's fields, filter and sort are used; at most 500 rows. Do not call a truncated list the full dataset.
  Show text; count, add up, group and sort with value, never by parsing text: money and numbers are numbers, a
  choice or status is its option id (text is its label), a time range is {start,end} and dates are ISO in UTC (group
  by hour or day in the workspace's time zone, Asia/Manila unless it says otherwise, with Intl.DateTimeFormat).
- Public HTML pages (including their signed-in previews) can ONLY read PUBLISHED layout or landing views.
  Layout result: {ok:true,viewId,name,type:"layout",layout:{sections:[{id,title,columns,items:[{id,component,data}]}]}}.
  Each item's data is the component's computed public output; table/data_table data has columns and items with
  cells as above, plus total. stat data has stat; list data has items with title/description/badge/image.
  Landing result: {ok:true,viewId,name,type:"landing",blocks:[...resolved public blocks]}.
  A records block has {id,type:"records",title,columns:[{id,name}],items:[{id,cells:[{fieldId,name,kind,text}]}]}.
  Use public layouts as explicit data sources, composing registered components with real entity/field ids.
- Public HTML pages may also read a TABLE view shared as public data: in assistant edits, update_view with that
  table's viewId and public:true shares it (records about people can't be shared; fields that identify people or show
  costs are left out automatically). Shared rows keep record ids, so detail pages can link with {@id}.
  If a required public source is missing, share a table (preferred), or propose a narrowly scoped public layout in
  assistant edits, or a published landing view with selected records blocks in setup (no layout type in setup schema).
  Never publish people/private data to make a design work; explain the missing safe source instead.
- Both private and public HTML can read published layout/landing results. No arbitrary entity query API exists.

FORMS: Connect to an actual PUBLIC form view in this workspace (create it in the same plan if requested).
Use <div data-everyops-embed="FORM_VIEW_ID"></div> for a standard form in assistant edits, OR freely design your
own <form data-everyops-form="FORM_VIEW_ID"> with inputs named by real field IDs. The bridge handles submission,
disables submit buttons and writes a [data-everyops-message] status; success is only after the server confirms.
For custom JavaScript use await EveryOps.form(id) => {ok:true,form:{viewId,title,fields,choices,booking,extras,...}}
and await EveryOps.submit(id,values,extras) => {ok:true,reference,title,summary,manage} or {ok:false,message}.
manage is the visitor's private link to that one booking (/b/...): show it after booking so they can check it or
send a proof of payment later. A page opened with ?manage=TOKEN can read that booking with EveryOps.mine() =>
{ok:true,title,reference,status:{label},summary:[{name,text}],attach:[{fieldId,name,added}]} and add a picture to
one of its attach fields with EveryOps.attach(fieldId,file); nothing else about the booking can be read or changed.
values are strings (or string arrays); option/relation values must be IDs from form.fields/options or form.choices.
Time ranges use FIELD_ID_start and FIELD_ID_end (ISO timestamps or Manila local date-times); date ranges use
FIELD_ID_start and FIELD_ID_end dates. Read the form contract before building selectors. Private forms are not
supported by this bridge: don't silently publish one without the user's request to accept public submissions.
For booking controls use EveryOps.slots(id,resourceId,"YYYY-MM-DD"), EveryOps.days(id,resourceId,from,count),
EveryOps.quote(id,values,extras), EveryOps.upload(id,file).
slots returns {ok:true,slots:[{start,end,free}]}; days returns {ok:true,days:[{day,free}]};
quote returns {ok:true,lines:[{name,text}]}; upload returns {ok:true,url}. Extras are {itemId:quantity}.
Use actual returned availability and prices; never
invent slots, compute a parallel pricing engine, or claim a saved booking before submit resolves ok:true.
Editor previews allow reads but deliberately don't save or upload; submissions work outside the editor and on the public page.
Use a standard booking form link when full custom booking controls aren't required.
Preserve existing live markers and existing form/data connections when restyling a page.
For new assistant pages use add_view html with starter=complete HTML and public:true if publishing was requested
(or update_view with that viewId and public:true). Do not claim a page is published without that flag. for existing pages use pageTexts with
markdown=complete HTML. In setup use html=complete HTML. Only publish when requested. Keep all changes undoable.`;
