import { describe, expect, it } from "vitest";
import { CATALOG } from "./index";
import { matchPlaybooks, PLAYBOOKS } from "./playbooks";

const ids = (text: string) => matchPlaybooks(text).map((p) => p.id);

describe("matchPlaybooks", () => {
  it("knows what a pickleball venue runs on", () => {
    const [courts] = matchPlaybooks("I have a pickleball place with 2 courts, I want a booking system");
    expect(courts?.id).toBe("courts");
    // The things the owner didn't say but will need: a public page in steps, add-ons, payments.
    expect(courts?.needs).toMatch(/public booking page in steps/i);
    expect(courts?.needs).toMatch(/add-ons/i);
    expect(courts?.references).toContain("court-bookings");
  });

  it.each([
    ["nail salon with 3 technicians", ["salon"]],
    ["We are a nail salon with 5 employees", ["salon"]],
    ["6 beach cottages for rent", ["stays"]],
    ["We need an HRIS for our 40 employees: attendance, leave and semi-monthly payroll with SSS", ["hris"]],
    ["POS para sa sari-sari store namin, may utang din yung mga suki", ["retail", "pos", "lending"]],
    ["milk tea shop with 2 branches, need a POS and inventory of ingredients", ["food", "pos", "inventory"]],
    ["We rent out sound systems, lights and tents for events", ["rentals"]],
    ["We rent out party and events equipment: sound systems, LED walls, tents", ["rentals"]],
    ["real estate brokerage, we track leads and listings and agent commissions", ["realestate", "crm"]],
    ["Our marketing agency needs project management with tasks and deadlines", ["agency", "projects"]],
    ["content calendar for our Facebook and TikTok posts with approvals", ["content"]],
    ["help desk for customer complaints and service requests", ["helpdesk"]],
    ["homeowners association: monthly dues, clubhouse bookings and gate passes", ["hoa"]],
    ["church with members, tithes and donations, and events", ["organizations", "memberships"]],
    ["piggery and poultry farm, track batches, feeds and harvest sales", ["farm"]],
    [
      "bakery that does made-to-order cakes, orders via Messenger, pickup or delivery",
      ["food", "orders", "delivery"],
    ],
    [
      "construction company: projects, bill of quantities, progress billing",
      ["contractors", "invoicing", "projects"],
    ],
    ["aircon cleaning and pest control services, home service", ["cleaning"]],
    ["coworking space with meeting rooms by the hour", ["spaces"]],
    ["pet grooming and pet hotel", ["pets"]],
    ["boarding house with 20 bedspaces, monthly rent and electricity billing", ["boarding"]],
    ["recruitment: job openings, applicants and onboarding requirements", ["recruitment"]],
    ["Our school needs enrollment, tuition installments and attendance", ["education"]],
    ["purchase requests and cash advance liquidation approvals for our office", ["approvals"]],
    ["daily opening and closing checklists and incident reports for our branches", ["inspections"]],
    ["support ticket system for our software customers", ["helpdesk"]],
    ["pickleball courts with a small cafe", ["courts", "food"]],
    // An ERP covers stock, purchasing, orders, invoicing and money; a maker or shop keeps its business playbook.
    ["I need an ERP.", ["erp"]],
    ["I need an ERP for my small furniture manufacturing shop.", ["production", "erp"]],
    ["ERP for our hardware store with inventory, suppliers and purchase orders", ["retail", "erp"]],
    ["hello there", []],
  ])("%s", (text, expected) => {
    expect(ids(text)).toEqual(expected);
  });
});

describe("playbooks", () => {
  it("have unique ids, real community references and real playbook ids in unless", () => {
    const all = PLAYBOOKS.map((p) => p.id);
    expect(new Set(all).size).toBe(all.length);
    const community = new Set(CATALOG.map((s) => s.id));
    const known = new Set(all);
    for (const p of PLAYBOOKS) {
      for (const r of p.references) expect(community, `${p.id} → ${r}`).toContain(r);
      for (const u of p.unless ?? []) expect(known, `${p.id} unless ${u}`).toContain(u);
    }
  });

  it("describe every workflow with its stages, so what gets built has statuses to move through", () => {
    for (const p of PLAYBOOKS) expect(p.needs, p.id).toMatch(/status\s[^.]*→/);
  });
});
