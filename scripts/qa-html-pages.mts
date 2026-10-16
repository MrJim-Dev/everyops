/**
 * Builds a synthetic workspace for checking manage links and page versions in a browser, against a LOCAL database
 * only: the court bookings sample with setup's website, a public booking form that asks an optional proof of
 * payment, and a public "My booking" custom page that reads the visitor's booking through EveryOps.mine().
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-html-pages.mts
 */
import { sql } from "kysely";
import type { HtmlPageView } from "@/lib/blueprint/types";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { withCustomSite } from "@/lib/public/custom-site";
import { publicFieldsOf } from "@/lib/public/resolve";
import { standardLanding } from "@/lib/public/site-template";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-html-pages";
const OWNER = { name: "QA Owner", email: "qa-pages@everyops.test", password: "qa-pages-2026" };

const MY_BOOKING = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>My booking · Court House PH</title>
<style>
body{margin:0;background:#f5f7f1;color:#14201a;font:16px/1.6 system-ui,-apple-system,sans-serif}
main{max-width:560px;margin:0 auto;padding:48px 22px}
h1{font-size:34px;letter-spacing:-.02em;margin:0 0 6px}
.card{background:#fff;border:1px solid #dfe7e0;border-radius:18px;padding:22px;margin-top:18px}
.tag{display:inline-block;font-size:13px;font-weight:600;color:#1f7a4d;background:#e1eee4;padding:3px 10px;border-radius:999px}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0} dt{color:#57685d} dd{margin:0;font-weight:600;text-align:right}
label.up{display:inline-block;margin-top:12px;background:#1f7a4d;color:#fff;padding:10px 16px;border-radius:12px;font-weight:600;cursor:pointer}
.muted{color:#57685d}
</style></head><body><main>
<p class="muted">Court House PH</p>
<h1 id="title">Your booking</h1>
<p id="ref" class="muted">Loading…</p>
<div class="card"><dl id="details"></dl></div>
<div class="card" id="proof" hidden><strong>Proof of payment</strong><p id="proof-state" class="muted"></p>
<label class="up">Send a screenshot<input id="file" type="file" accept="image/*" hidden></label></div>
</main>
<script>
function draw(r){
  if(!r||!r.ok){document.getElementById("ref").textContent=(r&&r.message)||"Open this page from your booking link.";return;}
  document.getElementById("title").textContent=r.title;
  document.getElementById("ref").innerHTML="";
  var ref=document.createElement("span");ref.textContent="Reference "+r.reference+" ";document.getElementById("ref").appendChild(ref);
  if(r.status){var t=document.createElement("span");t.className="tag";t.textContent=r.status.label;document.getElementById("ref").appendChild(t);}
  var dl=document.getElementById("details");dl.innerHTML="";
  r.summary.forEach(function(s){var dt=document.createElement("dt");dt.textContent=s.name;var dd=document.createElement("dd");dd.textContent=s.text;dl.appendChild(dt);dl.appendChild(dd);});
  var a=r.attach[0];if(!a)return;document.getElementById("proof").hidden=false;
  document.getElementById("proof-state").textContent=a.added?"Received. Thank you!":"Not sent yet.";
  document.getElementById("file").onchange=function(e){var file=e.target.files[0];if(!file)return;
    document.getElementById("proof-state").textContent="Uploading…";
    EveryOps.attach(a.fieldId,file).then(function(x){if(x&&x.ok)draw(x.booking);else document.getElementById("proof-state").textContent=(x&&x.message)||"That didn't upload.";});};
}
EveryOps.mine().then(draw);
</script></body></html>`;

async function ownerId(): Promise<string> {
  const found = await sql<{ id: string }>`select id from "user" where email = ${OWNER.email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  return (await auth.api.signUpEmail({ body: OWNER })).user.id;
}

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  const now = new Date();
  const name = "Court House PH";
  const { blueprint: bp, records } = courtBookingsSample(now, name);
  const booking = bp.entities.find((e) => e.id === "booking");
  if (!booking) throw new Error("Sample changed.");
  booking.fields.push({ id: "proof", name: "Proof of payment", type: "image" });
  const form = bp.views.find((v) => v.type === "form" && v.entityId === "booking");
  if (form?.type !== "form") throw new Error("No booking form.");
  form.public = true;
  if (form.fieldIds.length) form.fieldIds.push("proof");
  bp.systems.push({ id: "website", name: "Website", icon: "house", viewIds: [], widgetIds: [] });
  const website = bp.systems[bp.systems.length - 1];
  bp.views.push(
    standardLanding(bp, name, {
      contact: { phone: "0917 555 0123", address: "Mandaue City, Cebu", hours: "6 AM to 11 PM" },
    }),
  );
  website.viewIds.push("home");
  withCustomSite(bp, records, name, now);
  const mine: HtmlPageView = {
    id: "my_booking",
    entityId: "",
    name: "My booking",
    type: "html",
    public: true,
    html: MY_BOOKING,
  };
  bp.views.push(mine);
  website.viewIds.push("my_booking");

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
  const fields = publicFieldsOf(bp, form).map((x) => `${x.id}:${x.type}${x.required ? "*" : ""}`);
  const court = records.find((r) => r.entityId === "court");
  console.log(
    JSON.stringify({ workspace: SLUG, form: form.id, page: form.page ?? null, fields, court: court?.id }),
  );
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
