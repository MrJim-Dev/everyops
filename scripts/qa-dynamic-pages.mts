/**
 * Builds a synthetic workspace for checking dynamic custom HTML pages in a browser, against a LOCAL database only:
 * setup's website (bound to its own sections), a courts table shared as public data, a team-only shared header
 * included by two public pages, a courts list and a court detail page (/s/qa-court-house/court_detail/RECORD).
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-dynamic-pages.mts          # create or reset
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-dynamic-pages.mts restyle  # owner restyles cards
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-dynamic-pages.mts rename   # rename Court 1
 *
 * Refuses to run unless DATABASE_URL points at localhost.
 */
import { sql } from "kysely";
import type { HtmlPageView } from "@/lib/blueprint/types";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { withCustomSite } from "@/lib/public/custom-site";
import { standardLanding } from "@/lib/public/site-template";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { readCurrent, writeContent, writePages } from "@/server/workspace-data";

const SLUG = "qa-court-house";
const OWNER = { name: "QA Owner", email: "qa-owner@everyops.test", password: "qa-dynamic-pages-2026" };

const HEADER = `<!doctype html><html><head><style>
.site-top{display:flex;align-items:center;gap:20px;padding:16px 28px;background:#14201a;color:#f5f7f1;font:15px/1.4 system-ui,sans-serif}
.site-top strong{font-size:18px;margin-right:auto}
.site-top nav{display:flex;gap:6px;flex-wrap:wrap}
.site-top nav a{color:#cfe3d6;text-decoration:none;padding:6px 12px;border-radius:999px}
.site-top nav a[aria-current=true]{background:#1f7a4d;color:#fff}
.site-top .call{color:#f5f7f1;font-weight:600}
@media (max-width:640px){.site-top{flex-wrap:wrap;gap:8px 12px;padding:14px 16px}.site-top strong{flex-basis:100%}.site-top nav a{padding:5px 10px}.site-top .call{display:none}}
</style></head><body>
<header class="site-top">
  <strong data-everyops-text="site.name">Our club</strong>
  <nav aria-label="Pages"><template data-everyops-each="site.pages"><a data-href="{href}" aria-current="{current}" data-field="name"></a></template></nav>
  <a class="call" data-everyops-if="site.phone" data-everyops-bind data-href="tel:{site.phone}" data-everyops-text="site.phone"></a>
</header>
</body></html>`;

const PAGE_CSS = `<style>
body{margin:0;background:#f5f7f1;color:#14201a;font:16px/1.6 system-ui,-apple-system,sans-serif}
main{max-width:1040px;margin:0 auto;padding:40px 24px 72px}
h1{font-size:clamp(32px,5vw,48px);letter-spacing:-.02em;margin:0 0 8px}
.lead{color:#57685d;margin:0 0 28px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.court{background:#fff;border:1px solid #dfe7e0;border-radius:18px;padding:22px;display:grid;gap:8px}
.court h2{margin:0;font-size:20px}
.tag{justify-self:start;font-size:12px;font-weight:600;color:#1f7a4d;background:#e1eee4;padding:3px 10px;border-radius:999px}
.court a{color:#1f7a4d;font-weight:600;text-decoration:none}
.state{color:#57685d}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:20px 0}
dt{color:#57685d} dd{margin:0;font-weight:600}
.back{color:#1f7a4d}
</style>`;

const COURTS = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Our courts · Court House PH</title>
<meta name="description" content="Indoor and outdoor pickleball courts in Cebu City, with live availability and online booking.">
${PAGE_CSS}</head><body>
<div data-everyops-include="site_header"></div>
<main>
  <h1>Our courts</h1>
  <p class="lead">Every court we run, straight from our records. Pick one to see its details.</p>
  <div class="grid">
    <p class="state" data-everyops-state="loading">Loading courts…</p>
    <p class="state" data-everyops-state="empty" hidden>No courts are open right now.</p>
    <p class="state" data-everyops-state="error" hidden></p>
    <template data-everyops-each="courts_table" data-everyops-refresh="30">
      <article class="court">
        <span class="tag" data-everyops-if="surface" data-field="surface"></span>
        <h2 data-field="@title"></h2>
        <a data-href="/s/__everyops_site__/court_detail/{@id}">See details →</a>
      </article>
    </template>
  </div>
</main>
</body></html>`;

const DETAIL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Court details · Court House PH</title>${PAGE_CSS}</head><body>
<div data-everyops-include="site_header"></div>
<main>
  <a class="back" href="/s/__everyops_site__/courts_page">← All courts</a>
  <article data-everyops-record="courts_table">
    <p class="state" data-everyops-state="loading">Loading…</p>
    <p class="state" data-everyops-state="empty" hidden>We couldn't find that court.</p>
    <h1 data-field="@title"></h1>
    <dl><dt>Surface</dt><dd data-field="surface"></dd><dt>Bookings so far</dt><dd data-field="bookings"></dd></dl>
    <p>Call <a data-everyops-bind data-href="tel:{site.phone}" data-everyops-text="site.phone"></a> or book online.</p>
  </article>
</main>
</body></html>`;

async function ownerId(): Promise<string> {
  const found = await sql<{ id: string }>`select id from "user" where email = ${OWNER.email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  const made = await auth.api.signUpEmail({ body: OWNER });
  return made.user.id;
}

async function create() {
  const now = new Date();
  const name = "Court House PH";
  const { blueprint: bp, records } = courtBookingsSample(now, name);
  const form = bp.views.find((v) => v.type === "form");
  if (form?.type === "form") form.public = true;
  bp.systems.push({ id: "website", name: "Website", icon: "house", viewIds: [], widgetIds: [] });
  const website = bp.systems[bp.systems.length - 1];
  bp.views.push(
    standardLanding(bp, name, {
      contact: {
        phone: "0917 555 0123",
        address: "A. S. Fortuna St., Mandaue City, Cebu",
        hours: "6 AM to 11 PM daily",
      },
    }),
  );
  website.viewIds.push("home");
  withCustomSite(bp, records, name, now);
  const courts = bp.views.find((v) => v.id === "courts_table");
  if (courts?.type === "table") courts.publicData = true;
  const page = (id: string, viewName: string, html: string, pub: boolean): HtmlPageView => ({
    id,
    entityId: "",
    name: viewName,
    type: "html",
    public: pub,
    html,
  });
  bp.views.push(
    page("site_header", "Site header", HEADER, false),
    page("courts_page", "Our courts", COURTS, true),
    page("court_detail", "Court details", DETAIL, true),
  );
  website.viewIds.push("courts_page", "court_detail", "site_header");

  const owner = await ownerId();
  await sql`delete from workspace where id = ${SLUG}`.execute(db);
  const at = now.toISOString();
  const meta = { name, summary: "Bookings and payments", createdAt: at, openedAt: at, currentVersion: 1 };
  await sql`insert into workspace (id, owner_id, doc) values (${SLUG}, ${owner}, ${JSON.stringify(meta)}::jsonb)`.execute(
    db,
  );
  await db
    .transaction()
    .execute((trx) =>
      writeContent(trx, SLUG, { slug: SLUG, ...meta, versions: [bp], records, changes: [], docs: {} }),
    );
  const home = bp.views.find((v) => v.id === "home");
  console.log(
    JSON.stringify({
      workspace: SLUG,
      owner: OWNER.email,
      homeIsHtml: home?.type === "html",
      courts: records.filter((r) => r.entityId === "court").map((r) => [r.id, r.data.name]),
    }),
  );
}

/** Renames Court 1, the way a team member editing the record would. */
async function rename() {
  const res =
    await sql`update workspace_record set data = jsonb_set(data, '{name}', '"Center Court"'), rev = rev + 1, updated_at = now()
    where workspace_id = ${SLUG} and entity_id = 'court' and data->>'name' = 'Court 1'`.execute(db);
  console.log(JSON.stringify({ renamed: Number(res.numAffectedRows ?? 0) }));
}

/**
 * The owner redesigns the offer cards in Edit HTML: dark cards with an accent edge and a new class on the card. Only
 * markup and CSS change; the template and its bindings stay as setup wrote them.
 */
async function restyle() {
  const current = await readCurrent(db, SLUG);
  const home = current?.blueprint.views.find((v) => v.id === "home");
  if (home?.type !== "html" || !home.html) throw new Error("No setup website.");
  const css =
    ".owner-card{background:#14201a!important;color:#f5f7f1;border:0!important;border-left:6px solid #eaff00!important;border-radius:6px!important}.owner-card h3{font-size:24px!important;text-transform:uppercase;letter-spacing:.04em}.owner-card dt,.owner-card .about{color:#b9cbbf!important}.owner-card .tags span{background:#eaff00!important;color:#14201a!important}";
  const body = home.html
    .replace("</style>", `${css}</style>`)
    .replace('<article class="card reveal"><img', '<article class="card reveal owner-card"><img');
  if (!body.includes('owner-card"><img')) throw new Error("Card markup not found.");
  await db
    .transaction()
    .execute((trx) => writePages(trx, SLUG, { home: { body, updatedAt: new Date().toISOString() } }));
  console.log(JSON.stringify({ restyled: true }));
}

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  if (process.argv[2] === "rename") await rename();
  else if (process.argv[2] === "restyle") await restyle();
  else await create();
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
