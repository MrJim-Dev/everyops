/**
 * A fixed batch of real requests through /api/ai/assistant, so assistant changes are measured, not judged on one run.
 * It signs in to a running server (pnpm dev), builds a throwaway workspace from the court-bookings template with a
 * business memory, a website and a rules page, sends each request in a fresh conversation, checks the answer against
 * what the request should produce, prints the time each took, and deletes the workspace.
 *
 *   pnpm eval:assistant                 # against http://localhost:3000 with the demo account
 *   EVAL_BASE=… EVAL_EMAIL=… EVAL_PASSWORD=… pnpm eval:assistant
 */

import { writeFileSync } from "node:fs";
import type { ChangePlan } from "@/lib/engine/changes";
import { applyOps } from "@/lib/engine/changes";
import { applyRecordOps } from "@/lib/engine/records";
import { qualityFixture } from "./fixtures/assistant-quality";

const fixture = qualityFixture();
const REPEAT = Math.max(1, Math.min(5, Number(process.env.EVAL_REPEAT) || 1));
const REPORT = process.env.EVAL_REPORT;
const KEEP = process.env.EVAL_KEEP === "1";
const BASE = process.env.EVAL_BASE ?? "http://localhost:3000";
const EMAIL = process.env.EVAL_EMAIL ?? "james@everyops.app";
const PASSWORD = process.env.EVAL_PASSWORD ?? "everyops2026";
const ONLY = process.env.EVAL_ONLY; // run one case by name

let cookie = "";
let cleanupFailed = false;
async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", origin: BASE, cookie, ...(init.headers ?? {}) },
  });
  const set = res.headers.getSetCookie?.() ?? [];
  // Merge by name: a response that refreshes one cookie must not drop the session cookie.
  if (set.length) {
    const jar = new Map(cookie ? cookie.split("; ").map((c) => [c.split("=")[0], c] as const) : []);
    for (const c of set) {
      const pair = c.split(";")[0];
      jar.set(pair.split("=")[0], pair);
    }
    cookie = [...jar.values()].join("; ");
  }
  return { status: res.status, text: await res.text() };
}

type Result = {
  ok: boolean;
  kind?: string;
  reply?: string;
  message?: string;
  suggestions?: string[];
  navigate?: { path: string };
  remembered?: string[];
  evidence?: { status: string; queries: { scope: string; matched?: number }[] };
  sources?: { recordId?: string }[];
  plan?: ChangePlan;
};

type Case = {
  name: string;
  ask: string;
  history?: { role: "user" | "assistant"; text: string }[];
  expect: (r: Result) => string | null;
};

const ops = (r: Result) => [
  ...(r.plan?.ops ?? []).map((o) => o.op),
  ...(r.plan?.recordOps ?? []).map((o) => o.op),
];
const need = (cond: boolean, why: string) => (cond ? null : why);

const amounts = (r: Result) =>
  [...(r.reply ?? "").matchAll(/(?:₱|PHP\s*|P(?=\d))\s*([\d,]+(?:\.\d{1,2})?)/gi)].map((m) =>
    Number(m[1].replaceAll(",", "")),
  );
const CASES: Case[] = [
  {
    name: "multi-part request",
    ask: "Rename Players to Members and Courts to Venues. Keep Bookings unchanged.",
    expect: (r) => {
      if (!r.plan) return "must propose a plan";
      const next = applyOps(fixture.blueprint, r.plan.ops);
      return (
        need(
          next.systems.find((s) => s.id === "players")?.name === "Members" &&
            next.systems.find((s) => s.id === "courts")?.name === "Venues" &&
            next.systems.find((s) => s.id === "bookings")?.name === "Bookings" &&
            JSON.stringify(next.entities.find((e) => e.id === "booking")) ===
              JSON.stringify(fixture.blueprint.entities.find((e) => e.id === "booking")) &&
            JSON.stringify(next.views.filter((v) => v.entityId === "booking")) ===
              JSON.stringify(fixture.blueprint.views.filter((v) => v.entityId === "booking")),
          "must fulfill both renames and preserve Bookings",
        ) ?? need((r.plan.coverage?.length ?? 0) >= 2, "must review each requested change")
      );
    },
  },
  {
    name: "taglish total",
    ask: "Magkano ang nakolekta natin this month, paid bookings lang?",
    expect: (r) =>
      need(r.kind === "answer" && amounts(r).includes(1200), "must answer ₱1,200 for Taglish too"),
  },
  {
    name: "follow-up filter",
    ask: "GCash lang please.",
    history: [
      { role: "user", text: "How much have we collected this month?" },
      { role: "assistant", text: "₱1,200 from paid bookings this month." },
    ],
    expect: (r) =>
      need(
        r.kind === "answer" && amounts(r).includes(400) && !amounts(r).includes(1200),
        "must preserve this month and paid, then filter to GCash: ₱400",
      ),
  },
  {
    name: "empty result",
    ask: "How many paid bookings used Maya this month?",
    expect: (r) =>
      need(
        r.kind === "answer" && /\b0\b|no paid|no bookings|none|zero/i.test(r.reply ?? ""),
        "must report no matches, not a retrieval failure",
      ) ?? need(r.evidence?.status === "no_matches", "must distinguish an empty result"),
  },
  { name: "greeting", ask: "Hi!", expect: (r) => need(r.kind === "answer", "should just answer") },
  {
    name: "collected this month",
    ask: "How much have we collected this month?",
    expect: (r) =>
      need(
        r.kind === "answer" &&
          amounts(r).includes(fixture.expected.monthlyCollected) &&
          !amounts(r).includes(2400),
        "must report exactly ₱1,200 collected, excluding unpaid, cancelled and last month",
      ) ?? need(r.evidence?.status === "success", "must include successful retrieval evidence"),
  },
  {
    name: "unpaid today",
    ask: "Who still hasn't paid for today's bookings?",
    expect: (r) =>
      need(
        r.kind === "answer" &&
          /Miguel Santos/.test(r.reply ?? "") &&
          !/Ana Reyes|Bea Lim/.test(r.reply ?? ""),
        "must identify only Miguel as unpaid today",
      ) ??
      need(
        !!r.sources?.some((s) => s.recordId === fixture.expected.unpaidId),
        "must link the exact unpaid booking",
      ),
  },
  {
    name: "navigate",
    ask: "Open the courts page",
    expect: (r) => need(!!r.navigate, "should open a page"),
  },
  {
    name: "add field",
    ask: "Add a notes field to bookings",
    expect: (r) => need(ops(r).includes("add_field"), "should add a field"),
  },
  {
    name: "rename everywhere",
    ask: "Rename the Players page to Members",
    expect: (r) =>
      need(ops(r).includes("rename_system"), "should rename the page") ??
      need(
        (r.plan?.steps ?? []).some((s) => /new name everywhere|text on/i.test(s.label)),
        "should carry the name to the website and pages",
      ),
  },
  {
    name: "record update",
    ask: "Mark Miguel Santos's booking today as paid",
    expect: (r) => {
      const edits = r.plan?.recordOps ?? [];
      const intended = edits.find(
        (o) => o.op === "update_record" && o.recordId === fixture.expected.unpaidId,
      );
      if (!intended || intended.op !== "update_record" || intended.patch.status !== "paid")
        return "must mark the exact Miguel booking paid";
      const changed = applyRecordOps(fixture, edits);
      if (changed.errors.length) return changed.errors.join("; ");
      const changedIds = fixture.records
        .filter(
          (before) =>
            JSON.stringify(before.data) !==
            JSON.stringify(changed.data.records.find((after) => after.id === before.id)?.data),
        )
        .map((r) => r.id);
      return (
        need(
          changedIds.length === 1 && changedIds[0] === fixture.expected.unpaidId,
          "must preserve every unrelated record",
        ) ?? need(!!r.plan?.coverage?.length, "must review request coverage")
      );
    },
  },
  {
    name: "record delete",
    ask: "Delete Kevin Sy's Friday 8 PM booking",
    expect: (r) =>
      need(
        !r.plan &&
          (r.kind === "clarify" ||
            (r.kind === "answer" && !!r.evidence?.queries.some((q) => q.matched === 0))),
        "must report the absent booking or clarify without deleting another record",
      ),
  },
  {
    name: "future price change",
    ask: "We're raising the peak rate to ₱550 starting next Monday.",
    expect: (r) => {
      if (r.kind === "clarify") return null;
      const exprs = (r.plan?.ops ?? [])
        .map((o) =>
          o.op === "add_field"
            ? (o.field.formula?.expr ?? "")
            : o.op === "update_field"
              ? (o.patch.formula?.expr ?? "")
              : "",
        )
        .join(" ");
      // Next Monday in Manila, as the formula should name it.
      const today = new Date(
        `${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })}T12:00:00+08:00`,
      );
      const monday = new Date(today.getTime() + ((8 - today.getUTCDay()) % 7 || 7) * 86_400_000);
      const iso = monday.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
      return (
        need(/on_or_after\(/.test(exprs), "should start the new rate on the date, not now") ??
        need(exprs.includes(iso), `should start on next Monday, ${iso}: ${exprs}`)
      );
    },
  },
  {
    name: "new area",
    ask: "We hired coaches for weekend clinics. Add a way to track coaches and their clinic sessions.",
    expect: (r) => need(ops(r).includes("add_entity"), "should add record types"),
  },
  {
    name: "what next",
    ask: "What should I set up next?",
    expect: (r) => need(r.kind === "answer" && (r.suggestions?.length ?? 0) > 0, "should suggest next steps"),
  },
  {
    name: "remembers",
    ask: "Heads up: on weekends we now close at 11 PM.",
    expect: (r) => need(r.kind === "answer", "should acknowledge the business update"),
  },
];

async function makeWorkspace() {
  const signin = await call("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (signin.status !== 200) throw new Error(`sign-in failed: ${signin.status}`);
  const bp = fixture.blueprint;
  const form = bp.views.find((v: { type: string }) => v.type === "form");
  const blueprint = {
    ...bp,
    version: 1,
    workspaceName: "Rally House · AI quality",
    systems: [
      ...bp.systems,
      { id: "website", name: "Website", icon: "house", viewIds: ["home"], widgetIds: [] },
      { id: "info", name: "Info", icon: "file-text", viewIds: ["house_rules"], widgetIds: [] },
    ],
    views: [
      ...bp.views,
      {
        id: "home",
        entityId: "",
        name: "Home",
        type: "landing",
        public: true,
        blocks: [
          {
            id: "hero",
            type: "hero",
            heading: "Where Cebu's players meet",
            ctaLabel: "Book a court",
            ctaViewId: form?.id,
          },
          { id: "rates", type: "text", markdown: "Courts are ₱400 per hour." },
        ],
      },
      { id: "house_rules", entityId: "", name: "House rules", type: "document" },
    ],
  };
  const slug = `eval-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const setup = {
    prompt: "Pickleball venue with 4 indoor courts in Banilad, Cebu",
    progress: {
      messages: [],
      profile: [
        { label: "Courts", value: "4 indoor pickleball courts (Court 1 to Court 4)" },
        { label: "Hours", value: "6 AM to 10 PM daily; peak is 5 to 9 PM" },
        { label: "Rates", value: "₱400 per hour off-peak, ₱500 per hour at peak" },
      ],
    },
  };
  const meta = {
    name: "Rally House · AI quality",
    summary: "Pickleball court bookings",
    createdAt: now,
    openedAt: now,
    currentVersion: 1,
  };
  const created = await call(`/api/workspaces/${slug}`, {
    method: "PATCH",
    body: JSON.stringify({
      create: true,
      meta: { ...meta, setup },
      versions: [{ version: 1, blueprint }],
      records: { put: fixture.records.map((record: unknown) => ({ record, rev: null })), delete: [] },
      pages: {
        house_rules: { body: "# House rules\n\n- Check the Players page for your visits.\n", updatedAt: now },
      },
      changes: [],
      team: { members: [], invites: [] },
    }),
  });
  if (created.status !== 200) throw new Error(`create failed: ${created.text}`);
  // Finishing setup turns the profile into memory, as it does for a real workspace.
  await call(`/api/workspaces/${slug}`, { method: "PATCH", body: JSON.stringify({ meta }) });
  return slug;
}

async function ask(slug: string, text: string, history: Case["history"] = []) {
  const started = Date.now();
  const res = await call("/api/ai/assistant", {
    method: "POST",
    body: JSON.stringify({ workspaceId: slug, messages: [...history, { role: "user", text }] }),
  });
  // A dropped connection or a crash leaves no result line: that counts as a failure, not a script error.
  const lines = res.text.split("\n").flatMap((l) => {
    try {
      return l.trim() ? [JSON.parse(l)] : [];
    } catch {
      return [];
    }
  });
  const result = (lines.find((l) => l.type === "result") ?? {
    ok: false,
    message: `HTTP ${res.status}`,
  }) as Result;
  return {
    result,
    ms: Date.now() - started,
    steps: lines.filter((l) => l.type === "status").map((l) => l.text),
  };
}

const slug = await makeWorkspace();
console.log(`workspace ${slug}\n`);
const rows: { name: string; ms: number; pass: boolean; note: string; result: Result; steps: string[] }[] = [];
try {
  for (const c of Array.from({ length: REPEAT }, () =>
    CASES.filter((x) => !ONLY || x.name === ONLY),
  ).flat()) {
    const { result, ms, steps } = await ask(slug, c.ask, c.history);
    let problem = result.ok ? c.expect(result) : (result.message ?? "failed");
    if (!problem && c.name === "remembers") {
      const saved = await call(`/api/workspaces/${slug}/memory`);
      const notes = JSON.parse(saved.text).memory?.notes ?? [];
      const matches = notes.filter(
        (n: { text: string }) => /weekend/i.test(n.text) && /11\s*(PM|p\.m)|23:00/i.test(n.text),
      );
      problem = need(
        saved.status === 200 && matches.length === 1,
        "must persist the weekend closing time once, including after a repeated request",
      );
    }
    rows.push({
      result,
      steps,
      name: c.name,
      ms,
      pass: !problem,
      note: problem ?? `${result.kind} ${ops(result).join(",")}`.trim(),
    });
    console.log(
      `${problem ? "FAIL" : "pass"}  ${(ms / 1000).toFixed(1).padStart(5)} s  ${c.name.padEnd(22)} ${rows.at(-1)?.note}`,
    );
  }
} finally {
  if (!KEEP) {
    const deleted = await call(`/api/workspaces/${slug}`, { method: "DELETE" });
    if (deleted.status !== 200) {
      cleanupFailed = true;
      console.error(`Evaluation cleanup failed: ${deleted.status}`);
    }
  }
  if (REPORT)
    writeFileSync(
      REPORT,
      JSON.stringify(
        { workspace: slug, base: BASE, at: new Date().toISOString(), expected: fixture.expected, rows },
        null,
        2,
      ),
    );
}
const times = rows.map((r) => r.ms).sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)] ?? 0;
console.log(
  `\n${rows.filter((r) => r.pass).length}/${rows.length} passed · median ${(median / 1000).toFixed(1)} s · slowest ${((times.at(-1) ?? 0) / 1000).toFixed(1)} s`,
);
process.exitCode = rows.length > 0 && rows.every((r) => r.pass) && !cleanupFailed ? 0 : 1;
