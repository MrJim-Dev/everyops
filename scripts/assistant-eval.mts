/**
 * A fixed batch of real requests through /api/ai/assistant, so assistant changes are measured, not judged on one run.
 * It signs in to a running server (pnpm dev), builds a throwaway workspace from the court-bookings template with a
 * business memory, a website and a rules page, sends each request in a fresh conversation, checks the answer against
 * what the request should produce, prints the time each took, and deletes the workspace.
 *
 *   node scripts/assistant-eval.mts                 # against http://localhost:3000 with the demo account
 *   EVAL_BASE=… EVAL_EMAIL=… EVAL_PASSWORD=… node scripts/assistant-eval.mts
 */

const BASE = process.env.EVAL_BASE ?? "http://localhost:3000";
const EMAIL = process.env.EVAL_EMAIL ?? "james@everyops.app";
const PASSWORD = process.env.EVAL_PASSWORD ?? "everyops2026";
const ONLY = process.env.EVAL_ONLY; // run one case by name

let cookie = "";
async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", origin: BASE, cookie, ...(init.headers ?? {}) },
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
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
  plan?: {
    steps: { label: string; detail: string }[];
    ops: { op: string; field?: { formula?: { expr: string } }; patch?: { formula?: { expr: string } } }[];
    recordOps?: { op: string }[];
    docOps?: { viewId: string }[];
  };
};

type Case = { name: string; ask: string; expect: (r: Result) => string | null };

const ops = (r: Result) => [
  ...(r.plan?.ops ?? []).map((o) => o.op),
  ...(r.plan?.recordOps ?? []).map((o) => o.op),
];
const need = (cond: boolean, why: string) => (cond ? null : why);

const CASES: Case[] = [
  { name: "greeting", ask: "Hi!", expect: (r) => need(r.kind === "answer", "should just answer") },
  {
    name: "collected this month",
    ask: "How much have we collected this month?",
    expect: (r) => need(r.kind === "answer" && /₱/.test(r.reply ?? ""), "should answer with an amount"),
  },
  {
    name: "unpaid today",
    ask: "Who still hasn't paid for today's bookings?",
    expect: (r) => need(r.kind === "answer", "should answer"),
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
    expect: (r) => need(ops(r).includes("update_record"), "should update the booking"),
  },
  {
    name: "record delete",
    ask: "Delete Kevin Sy's Friday 8 PM booking",
    expect: (r) =>
      need(ops(r).includes("delete_record") || r.kind === "clarify", "should delete or ask which"),
  },
  {
    name: "future price change",
    ask: "We're raising the peak rate to ₱550 starting next Monday.",
    expect: (r) => {
      if (r.kind === "clarify") return null;
      const exprs = (r.plan?.ops ?? [])
        .map((o) => o.field?.formula?.expr ?? o.patch?.formula?.expr ?? "")
        .join(" ");
      // Next Monday in Manila, as the formula should name it.
      const today = new Date(
        new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) + "T12:00:00+08:00",
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
    expect: (r) => need((r.remembered?.length ?? 0) > 0, "should save it to memory"),
  },
];

async function makeWorkspace() {
  const signin = await call("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (signin.status !== 200) throw new Error(`sign-in failed: ${signin.status}`);
  const list = JSON.parse((await call("/api/workspaces")).text).workspaces as {
    slug: string;
    source?: { systemId: string };
  }[];
  const court = list.find((w) => (w.source?.systemId ?? "").includes("court"));
  if (!court) throw new Error("no court-bookings workspace to copy");
  const full = JSON.parse((await call(`/api/workspaces/${court.slug}`)).text).workspace;
  const bp = full.versions[full.currentVersion - 1];
  const form = bp.views.find((v: { type: string }) => v.type === "form");
  const blueprint = {
    ...bp,
    version: 1,
    workspaceName: "Rally House",
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
    name: "Rally House",
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
      records: { put: full.records.map((record: unknown) => ({ record, rev: null })), delete: [] },
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

async function ask(slug: string, text: string) {
  const started = Date.now();
  const res = await call("/api/ai/assistant", {
    method: "POST",
    body: JSON.stringify({ workspaceId: slug, messages: [{ role: "user", text }] }),
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
const rows: { name: string; ms: number; pass: boolean; note: string }[] = [];
try {
  for (const c of CASES.filter((x) => !ONLY || x.name === ONLY)) {
    const { result, ms } = await ask(slug, c.ask);
    const problem = result.ok ? c.expect(result) : (result.message ?? "failed");
    rows.push({
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
  await call(`/api/workspaces/${slug}`, { method: "DELETE" });
}
const times = rows.map((r) => r.ms).sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)] ?? 0;
console.log(
  `\n${rows.filter((r) => r.pass).length}/${rows.length} passed · median ${(median / 1000).toFixed(1)} s · slowest ${((times.at(-1) ?? 0) / 1000).toFixed(1)} s`,
);
process.exitCode = rows.every((r) => r.pass) ? 0 : 1;
