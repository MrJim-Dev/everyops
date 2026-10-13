import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { detectFile } from "./attachments";
import { officeText } from "./office";

async function workbook() {
  const wb = new ExcelJS.Workbook();
  const menu = wb.addWorksheet("Menu");
  menu.addRow(["Item", "Category", "Price"]);
  menu.addRow(["Chicken Adobo", "Ulam", 95]);
  menu.addRow(["Pancit, special", "Noodles", 120]);
  menu.getCell("C2").numFmt = '"₱"#,##0.00';
  const staff = wb.addWorksheet("Staff");
  staff.addRow(["Name", "Start date"]);
  staff.addRow(["Maria Santos", new Date(Date.UTC(2026, 9, 1))]);
  staff.getCell("B2").numFmt = "yyyy-mm-dd";
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("Office attachments", () => {
  it("reads every sheet of a workbook as CSV, with values as Excel shows them", async () => {
    const bytes = await workbook();
    expect(detectFile(bytes, "menu.xlsx", "")).toMatchObject({ kind: "text", ext: "csv", convert: "xlsx" });
    const text = await officeText(bytes, "xlsx");
    expect(text).toContain(
      'Sheet "Menu":\nItem,Category,Price\nChicken Adobo,Ulam,95\n"Pancit, special",Noodles,120',
    );
    expect(text).toContain('Sheet "Staff":\nName,Start date\nMaria Santos,2026-10-01');
  });

  it("reads the text of a Word document", async () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, "fixtures/roster.docx")));
    expect(detectFile(bytes, "roster.docx", "")).toMatchObject({ ext: "txt", convert: "docx" });
    const text = await officeText(bytes, "docx");
    expect(text).toContain("Jose Reyes, cook, Mon to Sat 5 AM - 1 PM");
  });

  it("refuses zips that aren't Office files and the older binary formats", async () => {
    const junk = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
    expect(await officeText(junk, "xlsx")).toBeNull();
    expect(detectFile(junk, "photos.zip", "application/zip")).toBeNull();
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(detectFile(xls, "rates.xls", "application/vnd.ms-excel")).toBeNull();
  });
});
