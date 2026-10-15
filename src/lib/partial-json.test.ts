import { describe, expect, it } from "vitest";
import { parsePartialJson } from "./partial-json";

describe("parsePartialJson", () => {
  it("keeps finished values and closes what is still open", () => {
    expect(parsePartialJson('{"systems":[{"id":"a","name":"Sales"},{"id":"b","na')).toEqual({
      systems: [{ id: "a", name: "Sales" }, { id: "b" }],
    });
  });

  it("leaves out a value that is still being written", () => {
    expect(parsePartialJson('{"name":"Kapé Ilaya","summary":"Coffee and')).toEqual({ name: "Kapé Ilaya" });
  });

  it("is not fooled by brackets, commas and escaped quotes inside strings", () => {
    expect(parsePartialJson('{"a":"x, [y] {z} \\"q\\"","b":[1,2')).toEqual({ a: 'x, [y] {z} "q"', b: [1] });
  });

  it("returns the whole document once it is complete", () => {
    expect(parsePartialJson('{"a":[1,{"b":true}],"c":null}')).toEqual({ a: [1, { b: true }], c: null });
  });

  it("returns undefined before anything has opened", () => {
    expect(parsePartialJson("")).toBeUndefined();
    expect(parsePartialJson("  ")).toBeUndefined();
  });
});
