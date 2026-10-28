import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { cleanFileName, formatBytes, kindOf, matchesFilter } from "@/lib/documents";
import { documentFileType } from "./documents";

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe("Documents file types", () => {
  it("takes videos and audio by what they are, not their name", () => {
    expect(documentFileType(bytes([0, 0, 0, 24], "ftypisom"), "Court tour.mp4")?.ext).toBe("mp4");
    expect(documentFileType(bytes([0, 0, 0, 20], "ftypqt  "), "IMG_0042.MOV")?.ext).toBe("mov");
    expect(documentFileType(bytes([0, 0, 0, 28], "ftypM4A "), "Voice memo.m4a")?.ext).toBe("m4a");
    expect(documentFileType(bytes([0x1a, 0x45, 0xdf, 0xa3]), "screen.webm")?.mime).toBe("video/webm");
    expect(documentFileType(bytes("RIFF", [0, 0, 0, 0], "WAVE"), "a.wav")?.mime).toBe("audio/wav");
    expect(documentFileType(bytes("ID3", [3, 0]), "song.mp3")?.mime).toBe("audio/mpeg");
  });

  it("takes documents, spreadsheets and exports, and refuses what could run in a browser", () => {
    expect(documentFileType(bytes("%PDF-1.7"), "Lease.pdf")?.ext).toBe("pdf");
    expect(documentFileType(bytes([0x50, 0x4b, 0x03, 0x04]), "Budget.xlsx")?.ext).toBe("xlsx");
    expect(documentFileType(bytes("Name,Amount\nCourt 1,400\n"), "bookings.csv")?.ext).toBe("csv");
    expect(documentFileType(bytes('{"records":[]}'), "backup.json")?.ext).toBe("json");
    expect(documentFileType(bytes("<html><script>alert(1)</script>"), "page.txt")).toBeNull();
    expect(documentFileType(bytes("<svg onload=alert(1)>"), "logo.svg")).toBeNull();
    expect(documentFileType(bytes([0x50, 0x4b, 0x03, 0x04]), "archive.zip")).toBeNull();
    expect(documentFileType(bytes("MZ", [0x90, 0]), "setup.exe")).toBeNull();
    expect(documentFileType(bytes("plain words", [0]), "notes.txt")).toBeNull();
  });

  it("names, sizes and sorts files the way people read them", () => {
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("Q3\u0000 report.pdf")).toBe("Q3 report.pdf");
    expect(cleanFileName("   ")).toBe("File");
    expect([
      formatBytes(820),
      formatBytes(820_000),
      formatBytes(1_400_000),
      formatBytes(2_100_000_000),
    ]).toEqual(["820 B", "820 KB", "1.4 MB", "2.1 GB"]);
    expect(kindOf("a/b/clip.MOV")).toBe("video");
    const exported = { kind: "spreadsheet" as const, source: "export" as const };
    expect(
      ["all", "documents", "exports", "images", "records"].map((f) => matchesFilter(exported, f as never)),
    ).toEqual([true, true, true, false, false]);
  });
});
