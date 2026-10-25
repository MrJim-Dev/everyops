import { describe, expect, it } from "vitest";
import { decideAi, fits, limitMessage, remainingCredits } from "./decide";
import {
  apiAllows,
  CREDIT_PACKS,
  creditsFromMicros,
  formatPeso,
  PLANS,
  PUBLIC_PLANS,
  yearlyCentavos,
} from "./plans";

const gate = (over: Partial<Parameters<typeof decideAi>[0]> = {}) =>
  decideAi({
    plan: PLANS.free,
    verified: true,
    suspended: false,
    usedCredits: 0,
    bonusCredits: 0,
    safetySwitchOn: false,
    feature: "assistant",
    ...over,
  });

describe("plans", () => {
  it("sells four plans whose limits only grow with the price", () => {
    expect(PUBLIC_PLANS.map((p) => p.id)).toEqual(["free", "starter", "pro", "business"]);
    for (let i = 1; i < PUBLIC_PLANS.length; i++) {
      const [a, b] = [PUBLIC_PLANS[i - 1], PUBLIC_PLANS[i]];
      expect(b.monthlyCentavos).toBeGreaterThan(a.monthlyCentavos);
      for (const key of ["credits", "workspaces", "members", "records", "storageMb", "emailsPerDay"] as const)
        expect(b.limits[key]).toBeGreaterThanOrEqual(a.limits[key]);
    }
  });

  it("keeps the most AI a paid plan can use under about a third of its price", () => {
    const usdToPhp = 58;
    for (const p of PUBLIC_PLANS.filter((p) => p.monthlyCentavos)) {
      const aiPesos = (p.limits.credits / 1000) * usdToPhp;
      expect(aiPesos / (p.monthlyCentavos / 100)).toBeLessThan(0.36);
    }
  });

  it("prices credit packs at least as high per credit as the plans", () => {
    for (const pack of CREDIT_PACKS) expect(pack.centavos / pack.credits).toBeGreaterThanOrEqual(9);
  });

  it("formats pesos, yearly prices and credits", () => {
    expect(formatPeso(49_900)).toBe("₱499");
    expect(formatPeso(yearlyCentavos(PLANS.pro))).toBe("₱14,990");
    expect(creditsFromMicros(127_200)).toBe(127);
  });

  it("limits API keys to reading on Starter and to nothing on Free", () => {
    expect(apiAllows("none", "records:read")).toBe(false);
    expect(apiAllows("read", "records:read")).toBe(true);
    expect(apiAllows("read", "records:write")).toBe(false);
    expect(apiAllows("full", "design:apply")).toBe(true);
  });
});

describe("decideAi", () => {
  it("lets a verified free account ask while it has credits", () => {
    expect(gate()).toEqual({ ok: true });
  });

  it("refuses in order: suspended, unverified, safety switch, credits", () => {
    expect(gate({ suspended: true, verified: false })).toMatchObject({ ok: false, code: "suspended" });
    expect(gate({ verified: false, safetySwitchOn: true })).toMatchObject({
      ok: false,
      code: "verify_email",
    });
    expect(gate({ safetySwitchOn: true, usedCredits: 5000 })).toMatchObject({
      ok: false,
      code: "safety_switch",
    });
    expect(gate({ usedCredits: 1000 })).toMatchObject({ ok: false, code: "credits" });
  });

  it("only pauses free and demo accounts when the safety switch is on", () => {
    expect(gate({ plan: PLANS.starter, safetySwitchOn: true })).toEqual({ ok: true });
    expect(gate({ plan: PLANS.demo, safetySwitchOn: true })).toMatchObject({ code: "safety_switch" });
  });

  it("needs a design's usual cost left before starting one, and counts this month's bonus", () => {
    expect(gate({ usedCredits: 900, feature: "setup-design" })).toMatchObject({ code: "credits" });
    expect(gate({ usedCredits: 900, feature: "assistant" })).toEqual({ ok: true });
    expect(gate({ usedCredits: 900, bonusCredits: 2000, feature: "setup-design" })).toEqual({ ok: true });
    expect(remainingCredits(PLANS.free, 1200, 0)).toBe(0);
  });

  it("speaks of the owner when a team member uses the owner's credits", () => {
    const d = gate({ usedCredits: 1000, forOwner: true });
    expect(d.ok ? "" : d.message).toMatch(/This workspace's owner has used/);
  });
});

describe("counted limits", () => {
  it("never blocks removing or staying over a limit, only adding past it", () => {
    expect(fits(1, 3, 0)).toBe(true);
    expect(fits(1, 3, -1)).toBe(true);
    expect(fits(1, 0, 1)).toBe(true);
    expect(fits(1, 1, 1)).toBe(false);
  });

  it("explains each limit with the plan's own numbers", () => {
    expect(limitMessage("workspaces", PLANS.free)).toContain("1 workspace besides");
    expect(limitMessage("records", PLANS.starter)).toContain("10,000 records");
    expect(limitMessage("customDomains", PLANS.free)).toContain("Pro plan");
  });
});
