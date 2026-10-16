/**
 * Measures the interview's design turn (the one that writes the brief) on a scripted conversation: how long it takes,
 * how long the brief is, and whether it chose a community system to start from. Run on two checkouts to compare.
 *
 *   set -a; source .env.local; set +a
 *   NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/setup-interview-bench.mts [label] [runs]
 */
import { appendFileSync } from "node:fs";
import { interviewTurn } from "@/server/ai/interview";
import { db } from "@/server/db";

const label = process.argv[2] ?? "run";
const runs = Number(process.argv[3] ?? 2);
const out = `/tmp/setup-interview-bench-${label}.jsonl`;

const user = (await db
  .selectFrom("user" as never)
  .select("id" as never)
  .where("email" as never, "=", "james@everyops.app" as never)
  .limit(1)
  .execute()) as { id: string }[];
const userId = user[0]?.id;
if (!userId) throw new Error("demo user not found");

// A pickleball venue: the owner's first message, the assistant's questions, and answers to every required question,
// then "build it". The last turn should design.
const messages = [
  {
    role: "user" as const,
    text: "I run Smash Pickleball Cebu, 4 indoor pickleball courts in Mandaue. I want online bookings with GCash payments.",
  },
  {
    role: "assistant" as const,
    text: "Here's what I'd set up: court bookings with a public booking page, payment methods with your GCash QR, add-ons for paddles and balls, and an Overview. A few quick questions below.",
  },
  {
    role: "user" as const,
    text: [
      "What are your opening hours and slot length? → 6:00 AM to 11:00 PM daily, 60-minute slots",
      "What do you charge per hour, and when does it change? → ₱400 before 5 PM on weekdays, ₱500 from 5 PM and all day weekends",
      "What do you rent or sell with a booking? → Paddle rental ₱100 each, balls ₱150 per can, towels ₱50",
      "How do customers pay? → GCash QR or cash at the counter; bookings stay pending until we confirm the reference",
      "Business name → Smash Pickleball Cebu. That's everything, please build it now.",
    ].join("\n"),
  },
];
const questions = [
  {
    id: "business_name",
    question: "What's the business called?",
    required: true,
    answer: "Smash Pickleball Cebu",
  },
  { id: "hours", question: "What are your opening hours and slot length?", required: true, answer: "" },
  {
    id: "rates",
    question: "What do you charge per hour, and when does it change?",
    required: true,
    answer: "",
  },
  { id: "addons", question: "What do you rent or sell with a booking?", required: false, answer: "" },
  { id: "payment", question: "How do customers pay?", required: true, answer: "" },
];

const info = console.info;
let events: Record<string, unknown>[] = [];
console.info = (line: unknown) => {
  if (typeof line === "string" && line.startsWith("{"))
    try {
      events.push(JSON.parse(line) as Record<string, unknown>);
    } catch {}
};
console.warn = console.info;
const rows: Record<string, unknown>[] = [];
for (let run = 1; run <= runs; run++) {
  events = [];
  const started = Date.now();
  const result = await interviewTurn(messages, userId, questions);
  const ms = Date.now() - started;
  const gemini = events.filter((e) => e.event === "gemini" && e.task === "interview");
  const row = {
    label,
    run,
    ok: result.ok,
    ms,
    action: result.ok ? result.turn.action : "error",
    briefChars: result.ok ? result.turn.brief.length : 0,
    base: result.ok ? (result.turn.base?.id ?? null) : null,
    startFrom: result.ok ? /^Start from: /m.test(result.turn.brief) : false,
    outputTokens: gemini.reduce((n, g) => n + Number(g.output ?? 0), 0),
    attempts: gemini.length,
    message: result.ok ? result.turn.message.slice(0, 160) : result.message,
  };
  rows.push(row);
  appendFileSync(out, `${JSON.stringify(row)}\n`);
  info(JSON.stringify(row));
}
console.info = info;
console.info(
  `\n${label}\n${rows
    .map(
      (r) =>
        `run ${r.run}  ${r.ok ? r.action : "FAIL"}  ${Math.round(Number(r.ms) / 1000)}s  brief ${r.briefChars} chars  base ${r.base ?? "-"}  out ${r.outputTokens}`,
    )
    .join("\n")}\nSaved to ${out}`,
);
process.exit(0);
