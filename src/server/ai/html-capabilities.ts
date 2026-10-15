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

DATA: await EveryOps.data("VIEW_ID") reads current results, not a snapshot embedded in the generated source.
- Private HTML pages inside the signed-in workspace may read table views. Result:
  {ok:true,viewId,name,type:"table",columns:[{id,name}],items:[{id,cells:[{fieldId,name,kind,text}]}],total,truncated}.
  Only that view's fields, filter and sort are used; at most 500 rows. Do not call a truncated list the full dataset.
- Public HTML pages (including their signed-in previews) can ONLY read PUBLISHED layout or landing views.
  Layout result: {ok:true,viewId,name,type:"layout",layout:{sections:[{id,title,columns,items:[{id,component,data}]}]}}.
  Each item's data is the component's computed public output; table/data_table data has columns and items with
  cells as above, plus total. stat data has stat; list data has items with title/description/badge/image.
  Landing result: {ok:true,viewId,name,type:"landing",blocks:[...resolved public blocks]}.
  A records block has {id,type:"records",title,columns:[{id,name}],items:[{id,cells:[{fieldId,name,kind,text}]}]}.
  Use public layouts as explicit data sources, composing registered components with real entity/field ids.
  If a required public source is missing, propose a narrowly scoped public layout alongside the HTML in assistant
  edits, or a published landing view with selected records blocks in setup (no layout type in setup schema).
  Never publish people/private data to make a design work; explain the missing safe source instead.
- Both private and public HTML can read published layout/landing results. No arbitrary entity query API exists.

FORMS: Connect to an actual PUBLIC form view in this workspace (create it in the same plan if requested).
Use <div data-everyops-embed="FORM_VIEW_ID"></div> for a standard form in assistant edits, OR freely design your
own <form data-everyops-form="FORM_VIEW_ID"> with inputs named by real field IDs. The bridge handles submission,
disables submit buttons and writes a [data-everyops-message] status; success is only after the server confirms.
For custom JavaScript use await EveryOps.form(id) => {ok:true,form:{viewId,title,fields,choices,booking,extras,...}}
and await EveryOps.submit(id,values,extras) => {ok:true,reference,title,summary} or {ok:false,message}.
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
