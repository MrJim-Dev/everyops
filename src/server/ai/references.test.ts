import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/community", () => ({ listCommunity: vi.fn(), getCommunity: vi.fn() }));

import type { Blueprint } from "@/lib/blueprint/types";
import { type CommunitySystem, listCommunity } from "@/server/community";
import { describeSystem, referencesText, setupReferences } from "./references";

const blueprint = { entities: [], systems: [], views: [], widgets: [], rules: [] } as unknown as Blueprint;
const system = (id: string, uses: number, active: number): CommunitySystem =>
  ({
    id,
    name: "Studio class bookings",
    summary: "Classes, members and bookings for a yoga studio.",
    includes: ["Classes", "Members"],
    blueprint,
    uses,
    active,
    recent: 0,
  }) as unknown as CommunitySystem;

describe("setup references and community usage", () => {
  it("puts the system more businesses actually run first when two fit as well", async () => {
    vi.mocked(listCommunity).mockResolvedValue([system("copied-once", 30, 0), system("in-use", 9, 6)]);
    const refs = await setupReferences("A yoga studio with classes and members");
    expect(refs.systems.map((s) => s.id)).toEqual(["in-use", "copied-once"]);
    expect(referencesText(refs)).toContain("prefer the one more businesses actively use");
  });

  it("tells the AI how much each system is used", () => {
    expect(describeSystem(system("in-use", 9, 6))).toContain(
      "Usage: Used by 9 workspaces, 6 active in the last 30 days",
    );
    expect(describeSystem({ id: "x", name: "X", summary: "", blueprint })).not.toContain("Usage:");
  });
});
