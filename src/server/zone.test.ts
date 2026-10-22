import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { dateKey, zone } from "@/lib/time";
import { enterZone, inZone } from "./zone";

describe("a request's time zone", () => {
  it("belongs to that request: two workspaces handled at once never share one", async () => {
    const seen: string[] = [];
    const handle = async (tz: string, wait: number) => {
      enterZone({ timeZone: tz });
      await new Promise((r) => setTimeout(r, wait));
      seen.push(`${tz}=${zone()}:${dateKey("2026-10-14T20:00:00.000Z")}`);
    };
    await Promise.all([
      inZone(undefined, () => handle("America/New_York", 20)),
      inZone(undefined, () => handle("Pacific/Auckland", 5)),
    ]);
    expect(seen.sort()).toEqual([
      "America/New_York=America/New_York:2026-10-14",
      "Pacific/Auckland=Pacific/Auckland:2026-10-15",
    ]);
    // Outside any request, Manila.
    expect(zone()).toBe("Asia/Manila");
  });
});
