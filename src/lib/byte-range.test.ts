import { describe, expect, it } from "vitest";
import { byteRange, MAX_RANGE_BYTES } from "./byte-range";

const SIZE = 69_000_000;

describe("byteRange", () => {
  it("caps an open range so the response stays under Cloud Run's limit", () => {
    expect(byteRange("bytes=0-", SIZE)).toEqual({ start: 0, end: MAX_RANGE_BYTES - 1 });
  });

  it("keeps a small explicit range and clamps to the file end", () => {
    expect(byteRange("bytes=100-199", SIZE)).toEqual({ start: 100, end: 199 });
    expect(byteRange(`bytes=${SIZE - 10}-${SIZE + 50}`, SIZE)).toEqual({ start: SIZE - 10, end: SIZE - 1 });
  });

  it("reads suffix ranges", () => {
    expect(byteRange("bytes=-500", SIZE)).toEqual({ start: SIZE - 500, end: SIZE - 1 });
  });

  it("sends the whole file without a usable header and refuses ranges past the end", () => {
    expect(byteRange(null, SIZE)).toBeNull();
    expect(byteRange("bytes=0-10,20-30", SIZE)).toBeNull();
    expect(byteRange(`bytes=${SIZE}-`, SIZE)).toBe("unsatisfiable");
  });
});
