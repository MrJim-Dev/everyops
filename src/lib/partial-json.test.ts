import { describe, expect, it } from "vitest";
import { parsePartialJson, partialString } from "./partial-json";

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

describe("partialString", () => {
  it("returns a string property as it is being written", () => {
    expect(partialString('{"action":"ask","message":"Hi! Tell me ab', "message")).toEqual({
      value: "Hi! Tell me ab",
      done: false,
    });
    expect(partialString('{"message":"Line one\\nLine \\"two\\"","questions":[', "message")).toEqual({
      value: 'Line one\nLine "two"',
      done: true,
    });
  });

  it("waits out an escape cut off at the end, and a property that hasn't started", () => {
    expect(partialString('{"message":"Caf\\u00', "message")).toEqual({ value: "Caf", done: false });
    expect(partialString('{"message":"a\\', "message")).toEqual({ value: "a", done: false });
    expect(partialString('{"action":"ask"', "message")).toBeUndefined();
  });
});
