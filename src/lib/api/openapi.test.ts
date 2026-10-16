import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { EveryOps } from "./client";
import { openapi, operations } from "./openapi";
import { cursor, parseFilters, revOf } from "./params";

const ROOT = join(process.cwd(), "src/app/api/v1");

/** Every route.ts under /api/v1, as its OpenAPI path ({id} for [id]) with the methods it exports. */
function handlers() {
  const out = new Map<string, Set<string>>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "route.ts") {
        const path = `/${relative(ROOT, dir)}`.replace(/\[(\w+)\]/g, "{$1}").replace(/\/$/, "");
        const methods = [
          ...readFileSync(full, "utf8").matchAll(/export (?:async )?function (GET|POST|PATCH|PUT|DELETE)\b/g),
        ];
        out.set(path, new Set(methods.map((m) => m[1].toLowerCase())));
      }
    }
  };
  walk(ROOT);
  out.delete("/openapi.json");
  return out;
}

describe("OpenAPI contract", () => {
  it("describes exactly the handlers in src/app/api/v1", () => {
    const actual = Object.fromEntries([...handlers()].map(([p, m]) => [p, [...m].sort()]));
    const spec = Object.fromEntries(
      Object.entries(openapi.paths).map(([p, m]) => [p, Object.keys(m).sort()]),
    );
    expect(spec).toEqual(actual);
  });

  it("has unique operation ids, each with a client method", () => {
    const ids = operations.map((o) => o.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids)
      expect(typeof (EveryOps.prototype as unknown as Record<string, unknown>)[id]).toBe("function");
  });

  it("declares every path parameter, and only those", () => {
    for (const o of operations) {
      const inPath = [...o.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const declared = (o.parameters ?? [])
        .filter((p) => p.in === "path")
        .map((p) => p.name)
        .sort();
      expect(declared, `${o.method} ${o.path}`).toEqual(inPath);
    }
  });

  it("resolves every $ref and gives every operation error responses", () => {
    const text = JSON.stringify(openapi);
    for (const [, name] of text.matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g))
      expect(openapi.components.schemas, name).toHaveProperty(name);
    for (const o of operations) {
      expect(Object.keys(o.responses)).toEqual(expect.arrayContaining(["401", "404"]));
      expect(Object.keys(o.responses).some((s) => s.startsWith("2"))).toBe(true);
    }
  });
});

describe("query parsing", () => {
  it("reads filters as FIELD:OP:VALUE, keeping colons in the value", () => {
    const p = new URLSearchParams([
      ["filter", "status:eq:Confirmed"],
      ["filter", "start:gte:2026-10-20T09:00"],
      ["filter", "notes:empty"],
    ]);
    expect(parseFilters(p)).toEqual([
      { fieldId: "status", op: "eq", value: "Confirmed" },
      { fieldId: "start", op: "gte", value: "2026-10-20T09:00" },
      { fieldId: "notes", op: "empty" },
    ]);
    expect(parseFilters(new URLSearchParams("filter=status:like:x"))).toMatch(/Bad filter/);
  });

  it("round-trips cursors and rejects made-up ones", () => {
    expect(cursor.decode(cursor.encode(50))).toBe(50);
    expect(cursor.decode(null)).toBe(0);
    expect(cursor.decode("nonsense")).toBeNull();
    expect(cursor.decode(Buffer.from('{"o":-3}').toString("base64url"))).toBeNull();
  });

  it("takes the rev from the body, the query or If-Match", () => {
    const url = "https://everyops.app/api/v1/workspaces/w/records/r";
    expect(revOf(new Request(url), { rev: 4 })).toBe(4);
    expect(revOf(new Request(`${url}?rev=2`))).toBe(2);
    expect(revOf(new Request(url, { headers: { "if-match": '"7"' } }))).toBe(7);
    expect(revOf(new Request(url))).toBeUndefined();
    expect(revOf(new Request(`${url}?rev=abc`))).toBeUndefined();
  });
});
