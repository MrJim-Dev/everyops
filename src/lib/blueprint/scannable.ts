import type { Entity, Field } from "./types";

/**
 * Fields a barcode or QR scanner can fill: text fields named for a code people scan, such as Barcode, SKU, UPC/EAN,
 * QR code, Serial number, Asset tag, ISBN, Item or product code, Tracking number. Read from the name, so a
 * workspace's products get a scan button without anyone setting it up.
 */
const CODE =
  /\b(bar ?codes?|sku|upc|ean|qr( code)?|serial( number| no\.?| #)?|asset (tag|code|number|no\.?)|isbn|(item|product|part|stock) (code|number|no\.?)|tracking (number|no\.?|code))\b/i;

export const isScannable = (field: Field) =>
  field.type === "text" && CODE.test(field.name.replace(/_/g, " "));

/** The fields of a record type a scan looks records up by. */
export const scannableFields = (entity: Entity | undefined) => (entity?.fields ?? []).filter(isScannable);

/** A scanned code as it's compared: trimmed, and the same whatever its letter case. */
export const sameCode = (a: unknown, b: string) =>
  typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();
