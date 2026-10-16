/**
 * Measures setup's design stage on fixed briefs, one per route (template, playbook, custom), straight through
 * designWorkspace: total time, Gemini calls, repairs, output tokens, whether the result validates, and its size.
 * Run it on two checkouts to compare them. Needs the Cloud SQL proxy (community systems) and gcloud ADC (Gemini):
 *
 *   set -a; source .env.local; set +a
 *   GEMINI_DESIGN_MODEL=gemini-3.5-flash GEMINI_DESIGN_LOCATION=asia-southeast1 \
 *   NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/setup-route-bench.mts [label] [runs] [scenario,...]
 *
 * Writes JSON lines to /tmp/setup-route-bench-<label>.jsonl and a summary table to stdout.
 */
import { appendFileSync } from "node:fs";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { designWorkspace } from "@/server/ai/design";

const SCENARIOS: Record<string, { name: string; brief: string }> = {
  // The brief the interview writes on the template route: the facts and the differences.
  "courts-short": {
    name: "Smash Pickleball Cebu",
    brief: `Start from: court-bookings
Smash Pickleball Cebu: 4 indoor pickleball courts in Mandaue, open 6:00 AM to 11:00 PM every day, 60-minute slots.
Rates: ₱400 per hour before 5 PM on weekdays, ₱500 per hour from 5 PM and all day on weekends. Add-ons: paddle rental
₱100 each, pickleball balls ₱150 per can (for sale), towels ₱50. Customers book on a public booking page and pay by
GCash (QR code) or cash at the counter; a booking stays pending until staff confirm the payment reference. Statuses:
pending payment, confirmed, checked in, completed, cancelled, no-show. Remove the "Booked via" field. Add a Players
page with visits and total spent.`,
  },
  // The brief the interview used to write for the same business: everything spelled out.
  "courts-long": {
    name: "Smash Pickleball Cebu",
    brief: `Business: Smash Pickleball Cebu, a pickleball venue in Mandaue with 4 indoor courts (Court 1 to Court 4), open 6:00 AM to 11:00 PM daily, 60-minute slots.

Record types:
- Courts: name (primary), surface (select: indoor, outdoor), active (checkbox). Bookable resource with opening hours 06:00–23:00, 60-minute slots.
- Rates: name (primary), rate per hour (money), applies (select: weekday day, weekday evening, weekend), active. Samples: Weekday day ₱400, Weekday evening (from 5 PM) ₱500, Weekend ₱500.
- Players: name (primary), phone, email, notes, visits (rollup count of bookings), total spent (rollup sum of booking total).
- Bookings: guest name (primary, text), phone, court (relation to Courts, required), time (time range, times, required), status (status: pending payment → confirmed → checked in → completed; cancelled; no-show), payment method (relation to Payment methods), payment reference (text), court fee (money formula: duration_hours(time) * (weekday(time.start) == 0 || weekday(time.start) == 6 || hour(time.start) >= 17 ? 500 : 400)), add-ons total (rollup sum of booking add-on line totals), total (money formula: court_fee + add_ons_total), notes.
- Add-ons: name (primary), price (money), unit (select: per hour, per piece), stock (number), active (checkbox). Samples: Paddle rental ₱100 per hour, Pickleball balls (can) ₱150 per piece, Towel ₱50 per piece.
- Booking add-ons (line items under Bookings): booking (relation, parent), add-on (relation), qty (number, required), line total (money formula: add_on.price * qty).
- Payment methods: label (primary), type (select: GCash, Maya, Bank transfer, Cash), account name, account number, instructions (long text), QR code (image), status (status: active, inactive). Samples: GCash (active), Cash at counter (active).
- FAQs: question (primary), answer (long text), order (number), published (checkbox). 4 samples about rates, cancellations, equipment, parking.

Pages (sidebar): Overview (bookings today, collected today, unpaid, revenue this month chart, today's schedule, busy hours), Bookings (Schedule slot grid, List table grouped by status with totals, Calendar, New booking staff form), Courts (table), Players (table), Add-ons (table), Payments (payment methods table), Website (landing page).

Public booking form (public true) in steps: Court and time → Add-ons (extras with quantities, filter active == true) → Your details (guest name, phone, email) → Payment (payment method, payment reference; show active payment methods block). Review step on. Site: headline "Book a court in seconds", intro, cta "Book a court", 3 highlights, 3 steps, contact hours 6 AM – 11 PM.

Rules: when a booking is cancelled, nothing changes stock; when a booking add-on with a "per piece" add-on is created, deduct qty from the add-on's stock.

Sample records: 4 courts, 3 rates, 5 players (Filipino names), 6 bookings spread across statuses dated around today with add-on lines, 3 add-ons, 2 payment methods, 4 FAQs.`,
  },
  // Playbooks match (salon + HRIS) but no one community system is the business.
  "salon-payroll": {
    name: "Luxe Hair Studio",
    brief: `Luxe Hair Studio, a hair salon in Cebu City with 5 stylists. Services with prices: haircut ₱350, hair color ₱1,800, rebond ₱3,500, treatment ₱900, blowdry ₱300. Appointments booked by phone and Messenger: client, stylist, service, time, status (requested → confirmed → in service → done; cancelled, no-show), payment (cash, GCash). Stylists earn a 40% commission on services they do, paid semi-monthly with payroll runs that list each stylist's services, commission and deductions (SSS, PhilHealth, Pag-IBIG as editable rates). Track daily attendance (time in, time out). Overview: appointments today, revenue this week and month, top services, stylist commissions this period.`,
  },
  // Nothing in the catalog looks like this; the design that failed in production three rounds running.
  "habit-custom": {
    name: "Daily Momentum",
    brief: `A personal activity and habit tracker called Daily Momentum. Activity Log: Title, Category (relation to Activity Category: Workout, Run, Reading, Meditation, Study), Date, Start Time, Duration Minutes, Duration Hours (formula), Distance Km, Pages Read, Sleep Quality (select: 1 - Poor, 2 - Fair, 3 - Good, 4 - Great, 5 - Optimal), Mood Rating (select 1 to 5), Energy Level (select: 1 - Drained, 2 - Low, 3 - Moderate, 4 - High, 5 - Peak), Notes & Reflection, Status (Planned → Logged; Skipped). Daily Summary: Date (primary), total active minutes (rollup), logs count (rollup), mood, energy level. Rule: when an Activity Log is saved as Logged, link it to the Daily Summary for that date. Overview: Active Days Streak This Month, Total Hours Active This Month, Workouts & Runs Completed, Total Pages Read This Month, Active Minutes by Day of Week & Hour heatmap, Category Breakdown chart, Recent Activity Logs list. Pages: Activity Log (table, board by status, calendar), Daily Summaries (table), Categories (table). Sample records for each.`,
  },
};

const label = process.argv[2] ?? "run";
const runs = Number(process.argv[3] ?? 2);
const only = process.argv[4]?.split(",");
const out = `/tmp/setup-route-bench-${label}.jsonl`;

type Row = Record<string, unknown>;
const rows: Row[] = [];
// design_done and the gemini call lines carry what the result doesn't: calls, repairs, tier, tokens.
const info = console.info;
const warn = console.warn;
let events: Row[] = [];
const capture = (line: unknown) => {
  if (typeof line === "string" && line.startsWith("{"))
    try {
      events.push(JSON.parse(line) as Row);
    } catch {}
};
console.info = (line: unknown) => capture(line);
console.warn = (line: unknown) => capture(line);

for (const [key, scenario] of Object.entries(SCENARIOS)) {
  if (only && !only.includes(key)) continue;
  for (let run = 1; run <= runs; run++) {
    events = [];
    const started = Date.now();
    const result = await designWorkspace(scenario.brief, scenario.name).catch((e) => ({
      ok: false as const,
      message: e instanceof Error ? e.message : String(e),
    }));
    const ms = Date.now() - started;
    const done = events.find((e) => e.event === "design_done") ?? {};
    const gemini = events.filter((e) => e.event === "gemini");
    const row: Row = {
      label,
      scenario: key,
      run,
      ok: result.ok,
      ms,
      tier: done.tier ?? "n/a",
      from: done.from ?? null,
      calls: done.calls ?? gemini.length,
      repairs: done.repairs ?? 0,
      outputTokens: done.output ?? 0,
      inputTokens: gemini.reduce((n, g) => n + Number(g.input ?? 0), 0),
      tasks: gemini.map((g) => `${g.task}:${Math.round(Number(g.ms) / 1000)}s`),
      rejected: events.filter((e) => e.event === "design_rejected").length,
      rejectedFor: events
        .filter((e) => e.event === "design_rejected")
        .map((e) => (e.errors as string[]).map((x) => x.slice(0, 160))),
      noProgress: events.some((e) => e.event === "design_no_progress"),
      patched: events.find((e) => e.event === "design_template_patched") ?? null,
      ...(result.ok
        ? {
            valid: validateBlueprint(result.data.blueprint).length === 0,
            entities: result.data.blueprint.entities.length,
            views: result.data.blueprint.views.length,
            records: result.data.records.length,
            gaps: result.gaps?.length ?? 0,
            gapList: (result.gaps ?? []).map((g) => g.request).slice(0, 6),
          }
        : { reason: result.message }),
    };
    rows.push(row);
    appendFileSync(out, `${JSON.stringify(row)}\n`);
    info(JSON.stringify(row));
  }
}

console.info = info;
console.warn = warn;
const line = (r: Row) =>
  [
    r.scenario,
    r.run,
    r.ok ? "ok" : "FAIL",
    `${Math.round(Number(r.ms) / 1000)}s`,
    r.tier,
    `calls ${r.calls}`,
    `repairs ${r.repairs}`,
    `out ${r.outputTokens}`,
    r.ok ? `valid ${r.valid} e${r.entities} v${r.views} r${r.records} gaps ${r.gaps}` : String(r.reason),
  ].join("  ");
console.info(`\n${label}\n${rows.map(line).join("\n")}\nSaved to ${out}`);
process.exit(0);
