import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ATTACHMENT_ID } from "@/lib/assistant/attachments";
import { detectFile } from "./attachments";

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe("detectFile", () => {
  it("recognises files by their content, not their name", () => {
    expect(detectFile(bytes([0x89], "PNG", [0, 0]), "menu.pdf", "application/pdf")?.mime).toBe("image/png");
    expect(detectFile(bytes("%PDF-1.7"), "rates", "")?.kind).toBe("pdf");
    expect(detectFile(bytes([0, 0, 0, 0x20], "ftypheic"), "IMG_1.HEIC", "")?.mime).toBe("image/heic");
  });

  it("tells browser voice recordings apart from videos in the same container", () => {
    const webm = bytes([0x1a, 0x45, 0xdf, 0xa3, 0, 0]);
    expect(detectFile(webm, "voice.webm", "audio/webm;codecs=opus")?.mime).toBe("audio/webm");
    expect(detectFile(webm, "clip.webm", "video/webm")?.kind).toBe("video");
    expect(detectFile(bytes([0, 0, 0, 0x1c], "ftypiso5"), "voice.m4a", "audio/mp4")?.mime).toBe("audio/mp4");
  });

  it("accepts readable text files and refuses everything else", () => {
    expect(detectFile(bytes("name,price\nAdobo,120\n"), "menu.csv", "text/csv")?.mime).toBe("text/csv");
    expect(
      detectFile(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"), "logo.svg", "image/svg+xml"),
    ).toBeNull();
    expect(detectFile(bytes("PK", [3, 4, 0, 0]), "rates.xlsx", "")).toBeNull();
    expect(detectFile(bytes("a,b", [0], "c"), "fake.csv", "text/csv")).toBeNull();
  });
});

describe("attachment ids", () => {
  it("only name files inside the account's own folder", () => {
    expect(ATTACHMENT_ID.test("0b6c7d5e-1f2a-4b3c-8d9e-0f1a2b3c4d5e.png")).toBe(true);
    expect(ATTACHMENT_ID.test("../other-user/0b6c7d5e-1f2a-4b3c-8d9e-0f1a2b3c4d5e.png")).toBe(false);
    expect(ATTACHMENT_ID.test("0b6c7d5e-1f2a-4b3c-8d9e-0f1a2b3c4d5e.svg")).toBe(false);
  });
});
