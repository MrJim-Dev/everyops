import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./coverage", () => ({ reviewCoverage: vi.fn() }));
vi.mock("./references", async (original) => ({
  ...(await original<typeof import("./references")>()),
  setupReferences: vi.fn(async () => ({ playbooks: [], systems: [] })),
}));
vi.mock("./samples", () => ({
  fillEmptySamples: vi.fn(async (_bp: unknown, samples: unknown) => samples),
  writeTemplateSamples: vi.fn(async () => null),
}));
vi.mock("./overview-layout", () => ({ withOverviewLayout: vi.fn(async (bp: unknown) => bp) }));
vi.mock("./gemini", async (original) => ({
  ...(await original<typeof import("./gemini")>()),
  generateJsonHedged: vi.fn(),
}));

import { validateBlueprint } from "@/lib/blueprint/validate";
import { CATALOG } from "@/lib/catalog";
import { PLAYBOOKS } from "@/lib/catalog/playbooks";
import { todayKey } from "@/lib/time";
import type { CommunitySystem } from "@/server/community";
import { reviewCoverage } from "./coverage";
import {
  applyDesignPatch,
  designWorkspace,
  ensurePublicForm,
  examplesFor,
  withoutInventedContacts,
} from "./design";
import type { Design, DesignPatch } from "./design-prompt";
import {
  designEntities,
  hoursFromBrief,
  noProgress,
  rebindTemplateSamples,
  samplesOf,
  seedDesign,
  seedForPrompt,
  withBriefHours,
} from "./design-template";
import { generateJsonHedged } from "./gemini";
import { setupReferences, setupRoute } from "./references";
import { writeTemplateSamples } from "./samples";

const tokens = { input: 1, output: 1, thinking: 0, cached: 0 };
const ok = (data: unknown) => ({ ok: true as const, data, model: "test", ms: 1, tokens });
const now = new Date("2026-10-16T02:00:00Z");

/** A catalog system the way the community table serves it: blueprint plus sample records built today. */
function community(id: string): CommunitySystem {
  const entry = CATALOG.find((s) => s.id === id);
  if (!entry) throw new Error(id);
  const data = entry.sample(now);
  return {
    id,
    name: entry.name,
    summary: entry.summary,
    category: entry.category,
    icon: entry.icon,
    author: entry.author,
    license: entry.license,
    version: entry.version,
    uses: 0,
    includes: entry.includes,
    blueprint: data.blueprint,
    sample: { records: data.records, builtOn: todayKey(now) },
    official: true,
    authorId: null,
    sourceWorkspaceId: null,
    publishedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
/** A value a test relies on, with a clear failure when it isn't there. */
function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
}
const playbook = (id: string) =>
  must(
    PLAYBOOKS.find((p) => p.id === id),
    `playbook ${id}`,
  );

describe("setupRoute", () => {
  const systems = CATALOG.map((s) => community(s.id));
  it("starts from the community system when one kind of business matches and it has a base", () => {
    const route = setupRoute("Pickleball venue in Cebu with 4 courts", {
      playbooks: [playbook("courts")],
      systems,
    });
    expect(route.tier).toBe("template");
    expect(route.base?.id).toBe("court-bookings");
  });
  it("designs from playbooks when a system (payroll) asks for more than the base covers", () => {
    const route = setupRoute("Pickleball courts with payroll for 6 staff", {
      playbooks: [playbook("courts"), playbook("hris")],
      systems,
    });
    expect(route.tier).toBe("playbook");
    expect(route.base).toBeUndefined();
  });
  it("designs from playbooks when two kinds of business match or the playbook has no base", () => {
    expect(
      setupRoute("courts and a café", { playbooks: [playbook("courts"), playbook("food")], systems }).tier,
    ).toBe("playbook");
    expect(setupRoute("a salon", { playbooks: [playbook("salon")], systems }).tier).toBe("playbook");
  });
  it("designs from scratch when nothing matches, and honours a system named in the brief", () => {
    expect(setupRoute("a habit tracker with streaks", { playbooks: [], systems }).tier).toBe("custom");
    const named = setupRoute("Start from: rental-operations\nA 3-unit transient house", {
      playbooks: [],
      systems,
    });
    expect(named.tier).toBe("template");
    expect(named.base?.id).toBe("rental-operations");
  });
  it("stays off the template route when the base isn't in the community", () => {
    expect(setupRoute("Pickleball venue", { playbooks: [playbook("courts")], systems: [] }).tier).toBe(
      "playbook",
    );
  });
});

describe("seedDesign", () => {
  it.each(CATALOG.map((s) => s.id))("turns %s into a design whose samples read back as its records", (id) => {
    const system = community(id);
    const { design } = seedDesign(system, "Mine", now);
    expect(design.workspaceName).toBe("Mine");
    expect(design.entities).toEqual(system.blueprint.entities);
    expect(design.views.length).toBe(system.blueprint.views.filter((v) => v.type !== "layout").length);
    expect(design.samples.length).toBe(system.sample?.records.length);
    // Every stored value that isn't computed comes through as text.
    const first = must(system.sample?.records[0], "a record");
    const sample = must(
      design.samples.find((s) => s.ref === first.id),
      "its sample",
    );
    const entity = must(
      system.blueprint.entities.find((e) => e.id === first.entityId),
      "its record type",
    );
    for (const f of entity.fields) {
      if (f.type === "formula" || f.type === "rollup" || first.data[f.id] == null) continue;
      expect(sample.values.some((v) => v.fieldId === f.id)).toBe(true);
    }
  });
  it("shows the prompt a few samples per record type", () => {
    const { design } = seedDesign(community("court-bookings"), "Courts", now);
    const shown = seedForPrompt(design, 3);
    const perEntity = new Map<string, number>();
    for (const s of shown.samples) perEntity.set(s.entityId, (perEntity.get(s.entityId) ?? 0) + 1);
    expect(Math.max(...perEntity.values())).toBe(3);
    expect(shown.samples.length).toBeLessThan(design.samples.length);
    expect(JSON.stringify(shown).length).toBeLessThan(20_000);
  });
  it("keeps a form's slot picking", () => {
    const system = community("court-bookings");
    const form = system.blueprint.views.find((v) => v.type === "form");
    const { forms } = seedDesign(system, "Courts", now);
    if (form && "bookingLayout" in form && form.bookingLayout) expect(forms.get(form.id)).toBeTruthy();
  });
});

describe("rebindTemplateSamples", () => {
  it("replaces a record type's samples with the patch's and re-links what pointed at the old ones", () => {
    const bp = community("court-bookings").blueprint;
    const court = must(
      bp.entities.find((e) => e.resource),
      "court",
    );
    const booking = must(
      bp.entities.find((e) => e.booking),
      "booking",
    );
    const courtField = must(booking.booking, "booking settings").resourceFieldId;
    const seed: Design = {
      workspaceName: "Courts",
      summary: "Courts",
      systems: [],
      entities: designEntities(bp.entities),
      views: [],
      widgets: [],
      rules: [],
      samples: [
        { ref: "c1", entityId: court.id, values: [{ fieldId: court.primaryFieldId, value: "Court 1" }] },
        { ref: "c2", entityId: court.id, values: [{ fieldId: court.primaryFieldId, value: "Court 2" }] },
        {
          ref: "b1",
          entityId: booking.id,
          values: [{ fieldId: courtField, value: "c1" }],
        },
        {
          ref: "b2",
          entityId: booking.id,
          values: [{ fieldId: courtField, value: "c2" }],
        },
        {
          ref: "b3",
          entityId: booking.id,
          values: [{ fieldId: courtField, value: "c1" }],
        },
      ],
    };
    const patch: DesignPatch = {
      samples: ["A", "B", "C"].map((n) => ({
        ref: `court_${n}`,
        entityId: court.id,
        values: [{ fieldId: court.primaryFieldId, value: `Court ${n}` }],
      })),
    };
    // What applyDesignPatch leaves: the old samples still there beside the new ones.
    const patched = { ...seed, samples: [...seed.samples, ...(patch.samples ?? [])] };
    const out = rebindTemplateSamples(seed, patched, patch);
    expect(out.samples.filter((s) => s.entityId === court.id).map((s) => s.ref)).toEqual([
      "court_A",
      "court_B",
      "court_C",
    ]);
    const courtsOf = out.samples
      .filter((s) => s.entityId === booking.id)
      .map((s) => s.values.find((v) => v.fieldId === courtField)?.value);
    expect(courtsOf).toEqual(["court_A", "court_B", "court_C"]);
  });
  it("leaves the samples alone when the patch has none", () => {
    const { design } = seedDesign(community("employee-leave"), "Leave", now);
    expect(rebindTemplateSamples(design, design, {})).toBe(design);
  });
});

describe("hoursFromBrief", () => {
  it("reads the hours and slot length the brief states", () => {
    expect(hoursFromBrief("open 6:00 AM to 11:00 PM every day, 60-minute slots")).toEqual({
      opensAt: "06:00",
      closesAt: "23:00",
      slotMinutes: 60,
    });
    expect(hoursFromBrief("Hours: 7am–10pm. Bookings are in 30 min slots.")).toEqual({
      opensAt: "07:00",
      closesAt: "22:00",
      slotMinutes: 30,
    });
    expect(hoursFromBrief("from 8 AM until 12 MN, 2-hour blocks")).toEqual({
      opensAt: "08:00",
      closesAt: "24:00",
      slotMinutes: 120,
    });
    expect(hoursFromBrief("open 6 to 11 PM")).toEqual({ opensAt: "06:00", closesAt: "23:00" });
  });
  it("ignores counts, dates and ranges without a time of day", () => {
    expect(hoursFromBrief("4-6 courts, rates ₱400-500, Oct 10-12")).toBeNull();
    expect(hoursFromBrief("open 9 to 5")).toBeNull();
  });
  it("puts the brief's hours on a resource the patch left as the template's, and only there", () => {
    const { design } = seedDesign(community("court-bookings"), "Courts", now);
    const court = must(
      design.entities.find((e) => e.resource),
      "court",
    );
    const same = withBriefHours(design, design, "Open 6:00 AM to 11:00 PM, 60-minute slots.");
    expect(same.entities.find((e) => e.id === court.id)?.resource).toEqual({
      opensAt: "06:00",
      closesAt: "23:00",
      slotMinutes: 60,
    });
    const changed = {
      ...design,
      entities: design.entities.map((e) =>
        e.id === court.id
          ? { ...e, resource: { opensAt: "09:00", closesAt: "21:00", slotMinutes: 30 as const } }
          : e,
      ),
    };
    expect(
      withBriefHours(design, changed, "Open 6:00 AM to 11:00 PM.").entities.find((e) => e.id === court.id)
        ?.resource,
    ).toEqual({ opensAt: "09:00", closesAt: "21:00", slotMinutes: 30 });
  });
});

describe("noProgress", () => {
  it("is true when every problem is still there, reworded or not", () => {
    expect(
      noProgress(
        [
          "Brief coverage: Activity Log record type with Sleep Quality field: Activity Log is missing the requested 'Sleep Quality' select field.",
        ],
        [
          "Brief coverage: Include Sleep Quality select field on Activity Log: Add the 'Sleep Quality' select field with options to Activity Log.",
        ],
      ),
    ).toBe(true);
    expect(
      noProgress(
        ["views.3: Board columns must use a status field"],
        ["views.3: Board columns must use a status field"],
      ),
    ).toBe(true);
  });
  it("is false when something was fixed or the problems changed", () => {
    expect(noProgress(["a: x", "b: y"], ["a: x"])).toBe(false);
    expect(
      noProgress(
        ["views.3: Board columns must use a status field"],
        ['widgets.0: "checkin.date" does not resolve'],
      ),
    ).toBe(false);
    expect(noProgress([], ["a: x"])).toBe(false);
  });
});

describe("designWorkspace on the template route", () => {
  const courts = community("court-bookings");
  beforeEach(() => {
    vi.mocked(generateJsonHedged).mockReset();
    vi.mocked(reviewCoverage).mockReset();
    vi.mocked(writeTemplateSamples).mockReset();
    vi.mocked(writeTemplateSamples).mockResolvedValue(null);
    vi.mocked(setupReferences).mockResolvedValue({ playbooks: [playbook("courts")], systems: [courts] });
    vi.mocked(reviewCoverage).mockResolvedValue({ covered: [], missing: [], errors: [], questions: [] });
  });

  it("writes the owner's configuration records beside the patch and they replace the template's", async () => {
    const court = must(
      courts.blueprint.entities.find((e) => e.resource),
      "court",
    );
    vi.mocked(writeTemplateSamples).mockResolvedValue(
      [1, 2, 3, 4, 5, 6].map((n) => ({
        ref: `n_court${n}`,
        entityId: court.id,
        values: [{ fieldId: court.primaryFieldId, value: `Court ${n}` }],
      })),
    );
    vi.mocked(generateJsonHedged).mockImplementation(async () => ok({}) as never);
    const result = await designWorkspace("Pickleball venue with 6 courts.", "Six");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(vi.mocked(writeTemplateSamples).mock.calls[0]?.[2]).toEqual([court.id]);
    const courtRecords = result.data.records.filter((r) => r.entityId === court.id);
    expect(courtRecords.map((r) => r.data.name)).toEqual([
      "Court 1",
      "Court 2",
      "Court 3",
      "Court 4",
      "Court 5",
      "Court 6",
    ]);
    const booking = must(
      courts.blueprint.entities.find((e) => e.booking),
      "booking",
    );
    const ids = new Set(courtRecords.map((r) => r.id));
    const field = must(booking.booking, "booking settings").resourceFieldId;
    const bookings = result.data.records.filter((r) => r.entityId === booking.id);
    expect(bookings.length).toBeGreaterThan(100);
    expect(bookings.every((b) => ids.has(String(b.data[field])))).toBe(true);
    // One structural call; the configuration call is separate and no repair was needed.
    expect(vi.mocked(generateJsonHedged).mock.calls.map((c) => c[1].task)).toEqual(["design-template"]);
  });

  it("asks for a patch on the community system and hands over its records", async () => {
    const court = must(
      courts.blueprint.entities.find((e) => e.resource),
      "court",
    );
    vi.mocked(generateJsonHedged).mockImplementation(async (_schema, input) => {
      expect(input.task).toBe("design-template");
      expect(typeof input.prompt === "string" && input.prompt.includes("(court-bookings)")).toBe(true);
      // The prompt names the configuration records the patch must write; the patch writes the owner's courts.
      expect(typeof input.prompt === "string" && input.prompt.includes("Courts (court)")).toBe(true);
      return ok({
        samples: [1, 2, 3, 4].map((n) => ({
          ref: `c${n}`,
          entityId: court.id,
          values: [{ fieldId: court.primaryFieldId, value: `Court ${n}` }],
        })),
      }) as never;
    });
    const events: unknown[] = [];
    const result = await designWorkspace(
      "Pickleball venue in Cebu with 4 courts, ₱400 an hour.",
      "Smash Cebu",
      {
        onEvent: (e) => events.push(e),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe("Smash Cebu");
    expect(validateBlueprint(result.data.blueprint)).toEqual([]);
    // The template's records came through (the court-bookings sample is a season of bookings), on the new courts.
    expect(result.data.records.length).toBeGreaterThan(100);
    expect(result.data.records.filter((r) => r.entityId === court.id)).toHaveLength(4);
    expect(result.data.blueprint.entities.map((e) => e.id)).toEqual(
      courts.blueprint.entities.map((e) => e.id),
    );
    expect(events[0]).toMatchObject({ type: "stage", stage: "design", from: { id: "court-bookings" } });
    // The sketch of the template's pages arrives before Gemini answers.
    expect(events[1]).toMatchObject({ type: "sketch" });
    expect(vi.mocked(generateJsonHedged)).toHaveBeenCalledTimes(1);
  });

  it("sends a patch that kept the template's configuration records back for repair, naming them", async () => {
    const court = must(
      courts.blueprint.entities.find((e) => e.resource),
      "court",
    );
    vi.mocked(generateJsonHedged).mockImplementation(async (_schema, input) => {
      if (input.task === "design-template") return ok({}) as never;
      expect(input.task).toBe("design-fix");
      expect(
        typeof input.prompt === "string" &&
          /Courts \(court\): the sample records are still/.test(input.prompt),
      ).toBe(true);
      return ok({
        samples: ["A", "B"].map((n) => ({
          ref: `court_${n}`,
          entityId: court.id,
          values: [{ fieldId: court.primaryFieldId, value: `Court ${n}` }],
        })),
      }) as never;
    });
    const result = await designWorkspace("Two courts, open 7am to 10pm.", "Two Courts");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.records.filter((r) => r.entityId === court.id).map((r) => r.data.name)).toEqual([
      "Court A",
      "Court B",
    ]);
    expect(vi.mocked(generateJsonHedged).mock.calls.map((c) => c[1].task)).toEqual([
      "design-template",
      "design-fix",
    ]);
  });

  it("applies the patch: the owner's courts replace the template's and bookings follow", async () => {
    const court = must(
      courts.blueprint.entities.find((e) => e.resource),
      "court",
    );
    const patch: DesignPatch = {
      samples: ["Court A", "Court B", "Court C", "Court D", "Court E", "Court F"].map((name, i) => ({
        ref: `court_new_${i}`,
        entityId: court.id,
        values: [{ fieldId: court.primaryFieldId, value: name }],
      })),
    };
    vi.mocked(generateJsonHedged).mockImplementation(async () => ok(patch) as never);
    const result = await designWorkspace("Pickleball venue with 6 courts.", "Six Courts");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const courtRecords = result.data.records.filter((r) => r.entityId === court.id);
    expect(courtRecords.map((r) => r.data[court.primaryFieldId]).sort()).toEqual([
      "Court A",
      "Court B",
      "Court C",
      "Court D",
      "Court E",
      "Court F",
    ]);
    const booking = must(
      courts.blueprint.entities.find((e) => e.booking),
      "booking",
    );
    const courtField = must(booking.booking, "booking settings").resourceFieldId;
    const bookings = result.data.records.filter((r) => r.entityId === booking.id);
    const courtIds = new Set(courtRecords.map((r) => r.id));
    expect(bookings.length).toBeGreaterThan(0);
    expect(bookings.every((b) => courtIds.has(String(b.data[courtField])))).toBe(true);
    expect(validateBlueprint(result.data.blueprint)).toEqual([]);
  });

  it("designs from scratch when the patch never comes back", async () => {
    vi.mocked(generateJsonHedged).mockImplementation(async (_schema, input) =>
      input.task === "design-template"
        ? ({ ok: false, error: "Gemini took too long to answer.", retryable: true } as never)
        : (ok(seedDesign(courts, "Fallback", now).design) as never),
    );
    const result = await designWorkspace("Pickleball venue with 4 courts.", "Fallback");
    expect(result.ok).toBe(true);
    expect(vi.mocked(generateJsonHedged).mock.calls.map((c) => c[1].task)).toEqual([
      "design-template",
      "design",
    ]);
  });

  it("honours the base the interview chose even when the brief alone wouldn't route there", async () => {
    vi.mocked(setupReferences).mockResolvedValue({ playbooks: [], systems: [courts] });
    vi.mocked(generateJsonHedged).mockImplementation(async () => ok({}) as never);
    const result = await designWorkspace("Four courts, open 6am to 11pm.", "Chosen", {
      base: "court-bookings",
    });
    expect(result.ok).toBe(true);
    expect(vi.mocked(generateJsonHedged).mock.calls[0][1].task).toBe("design-template");
  });
});

describe("designWorkspace settles when a repair makes no progress", () => {
  it("hands over the best design after one unchanged repair instead of a third round", async () => {
    vi.mocked(generateJsonHedged).mockReset();
    vi.mocked(reviewCoverage).mockReset();
    vi.mocked(setupReferences).mockResolvedValue({ playbooks: [], systems: [] });
    const leave = community("employee-leave");
    const design = seedDesign(leave, "Leave", now).design;
    vi.mocked(generateJsonHedged).mockImplementation(
      async (_schema, input) => (input.task === "design" ? ok(design) : ok({})) as never,
    );
    vi.mocked(reviewCoverage).mockResolvedValue({
      covered: [],
      missing: ["Overtime"],
      errors: ["Overtime: there is no overtime record type."],
      questions: [],
    });
    const result = await designWorkspace("Leave and overtime for a 20-person team.", "Leave");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gaps?.map((g) => g.request)).toContain("Overtime");
    // Design, one repair, then settled: no second repair.
    expect(vi.mocked(generateJsonHedged).mock.calls.map((c) => c[1].task)).toEqual(["design", "design-fix"]);
  });
});

describe("examplesFor", () => {
  const systems = CATALOG.map((s) => community(s.id));
  it("gives the playbook route the matched systems, the custom route the standard pair, the template route none", () => {
    const playbooks = [playbook("salon")];
    const matched = examplesFor({ tier: "playbook" }, { playbooks, systems: [systems[4], systems[0]] });
    expect(matched.startsWith(JSON.stringify(systems[4].blueprint))).toBe(true);
    expect(examplesFor({ tier: "custom" }, { playbooks: [], systems: [] })).toContain('"Court bookings"');
    expect(examplesFor({ tier: "template", base: systems[0] }, { playbooks, systems })).toBe("");
  });
});

describe("samplesOf", () => {
  it("writes every value kind the way toFieldValue reads it", () => {
    const pos = community("canteen-pos");
    const samples = samplesOf(pos.blueprint, must(pos.sample, "sample").records.slice(0, 50));
    const values = samples.flatMap((s) => s.values.map((v) => v.value));
    expect(values.every((v) => typeof v === "string" && v.length > 0)).toBe(true);
  });
});

describe("withoutInventedContacts", () => {
  it("keeps an account number the brief gives and drops one Gemini made up", () => {
    const design = {
      entities: [
        {
          id: "payment_method",
          name: "Payment method",
          pluralName: "Payment methods",
          primaryFieldId: "name",
          fields: [
            { id: "name", name: "Name", type: "text" as const },
            { id: "account_number", name: "Account number", type: "text" as const },
            { id: "instructions", name: "Instructions", type: "long_text" as const },
          ],
        },
      ],
    };
    const samples = [
      {
        ref: "n_1",
        entityId: "payment_method",
        values: [
          { fieldId: "name", value: "GCash" },
          { fieldId: "account_number", value: "0917 123 4567" },
          { fieldId: "instructions", value: "Send the reference number." },
        ],
      },
    ];
    const invented = withoutInventedContacts(samples, design, "Customers pay by GCash or cash.");
    expect(invented[0].values.map((v) => v.fieldId)).toEqual(["name", "instructions"]);
    const given = withoutInventedContacts(samples, design, "GCash 0917-123-4567 (Smash Pickleball).");
    expect(given[0].values.map((v) => v.fieldId)).toEqual(["name", "account_number", "instructions"]);
  });
  it("treats phone and email fields as contact details whatever their name", () => {
    const design = {
      entities: [
        {
          id: "supplier",
          name: "Supplier",
          pluralName: "Suppliers",
          primaryFieldId: "name",
          fields: [
            { id: "name", name: "Name", type: "text" as const },
            { id: "main", name: "Main", type: "phone" as const },
            { id: "inbox", name: "Inbox", type: "email" as const },
          ],
        },
      ],
    };
    const samples = [
      {
        ref: "s1",
        entityId: "supplier",
        values: [
          { fieldId: "name", value: "Cebu Paddles" },
          { fieldId: "main", value: "0917 555 0101" },
          { fieldId: "inbox", value: "orders@cebupaddles.ph" },
        ],
      },
    ];
    expect(withoutInventedContacts(samples, design, "Our supplier is Cebu Paddles.")[0].values).toHaveLength(
      1,
    );
  });
});

describe("ensurePublicForm", () => {
  const bp = community("court-bookings").blueprint;
  const booking = must(
    bp.entities.find((e) => e.booking),
    "booking",
  );
  it("copies the booking form as a public one, without statuses and how the booking was made", () => {
    const out = ensurePublicForm(bp, "Customers book on a public booking page and pay by GCash.");
    const added = out.views.find((v) => v.type === "form" && v.public);
    expect(added).toBeTruthy();
    if (!added || added.type !== "form") return;
    expect(added.entityId).toBe(booking.id);
    const status = must(booking.booking, "booking settings").statusFieldId;
    expect(added.fieldIds).not.toContain(status);
    expect(added.fieldIds).not.toContain("source");
    expect(added.fieldIds).toContain(must(booking.booking, "booking settings").resourceFieldId);
    expect(added.steps?.every((s) => s.fieldIds.length)).toBe(true);
    // On the same page as the staff form, and the staff form stays private.
    const page = out.systems.find((s) => s.viewIds.includes(added.id));
    expect(page?.viewIds).toContain("new_booking");
    expect(out.views.filter((v) => v.type === "form" && v.public)).toHaveLength(1);
  });
  it("adds nothing when the brief doesn't ask, or a public form exists", () => {
    expect(ensurePublicForm(bp, "Staff book courts at the front desk; no online booking.")).toBe(bp);
    const once = ensurePublicForm(bp, "A public booking page.");
    expect(ensurePublicForm(once, "A public booking page.")).toBe(once);
  });
});

describe("applyDesignPatch on a template", () => {
  it("keeps a record type's resource hours and booking settings when the patch returns it without them", () => {
    const { design } = seedDesign(community("court-bookings"), "Courts", now);
    const court = must(
      design.entities.find((e) => e.resource),
      "court",
    );
    const booking = must(
      design.entities.find((e) => e.booking),
      "booking",
    );
    const patched = applyDesignPatch(design, {
      entities: [
        {
          id: court.id,
          name: "Pickleball court",
          pluralName: "Pickleball courts",
          primaryFieldId: "name",
          fields: [],
        },
        { ...booking, booking: undefined, fields: [] },
      ],
    }).design;
    const after = must(
      patched.entities.find((e) => e.id === court.id),
      "court after",
    );
    expect(after.name).toBe("Pickleball court");
    expect(after.resource).toEqual(court.resource);
    expect(after.fields.map((f) => f.id)).toEqual(court.fields.map((f) => f.id));
    expect(patched.entities.find((e) => e.id === booking.id)?.booking).toEqual(booking.booking);
  });
  it("keeps a custom page's HTML when the patch returns the page without it", () => {
    const seed: Design = {
      ...seedDesign(community("court-bookings"), "Courts", now).design,
      views: [
        { id: "home", entityId: "", name: "Home", type: "html", public: true, html: "<h1>Hi</h1>" },
      ] as unknown as Design["views"],
    };
    const patched = applyDesignPatch(seed, {
      views: [{ id: "home", entityId: "", name: "Smash Pickleball", type: "html", public: true }] as never,
    }).design;
    expect(patched.views[0]).toMatchObject({ name: "Smash Pickleball", html: "<h1>Hi</h1>" });
  });
});
