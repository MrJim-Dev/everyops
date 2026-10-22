import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "kysely";
import { optionOf, recordTitle } from "@/lib/blueprint/lookup";
import type { DataRecord, Entity, FormView, Tone } from "@/lib/blueprint/types";
import { isImagePath } from "@/lib/engine/records";
import { autoReferenceFields } from "@/lib/engine/references";
import { formatCell, publicFieldsOf, siteOf } from "@/lib/public/resolve";
import { logActivity } from "./activity";
import { db } from "./db";
import { saveImage } from "./storage";
import { queueChanges, sendSoon } from "./webhooks";
import { currentBlueprint, putRecords, readCurrent, readRecords } from "./workspace-data";

/**
 * Manage links: after a public booking, the visitor gets a link to that one booking (/b/TOKEN). It shows the
 * booking's reference, status and details, and lets them add a picture the form asks for (a proof of payment)
 * later. The token is signed with the app's secret and names the workspace, the form and the record, so it can't be
 * turned into another booking, another form or another workspace, and it stops working after DAYS.
 */
const DAYS = 60;
const ID = /^[a-z0-9][a-z0-9-]{1,79}$/;

const secret = () => {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set.");
  return s;
};
const sign = (payload: string) =>
  createHmac("sha256", `manage:${secret()}`).update(payload).digest("base64url");

export type ManageClaim = { workspace: string; view: string; record: string };

export function manageToken(claim: ManageClaim, now = new Date()): string {
  const payload = Buffer.from(
    JSON.stringify({
      w: claim.workspace,
      v: claim.view,
      r: claim.record,
      e: Math.floor(now.getTime() / 1000) + DAYS * 86_400,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export const managePath = (claim: ManageClaim, now = new Date()) => `/b/${manageToken(claim, now)}`;

/** The booking a token names, or null when it's been changed, has expired or isn't one. */
export function readManageToken(token: string, now = new Date()): ManageClaim | null {
  if (typeof token !== "string" || token.length > 600) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (
      typeof p.w !== "string" ||
      typeof p.v !== "string" ||
      typeof p.r !== "string" ||
      typeof p.e !== "number"
    )
      return null;
    if (p.e * 1000 < now.getTime() || !ID.test(p.w)) return null;
    return { workspace: p.w, view: p.v, record: p.r };
  } catch {
    return null;
  }
}

export type ManagedBooking = {
  ok: true;
  site: string;
  title: string;
  reference: string;
  status?: { label: string; tone: Tone };
  summary: { name: string; text: string }[];
  /** Pictures the form asks for (a proof of payment), and whether this booking has one yet. */
  attach: { fieldId: string; name: string; added: boolean }[];
};
type Problem = { ok: false; status: number; message: string };

const GONE: Problem = { ok: false, status: 404, message: "This booking link doesn't work any more." };

function shown(
  bp: Parameters<typeof formatCell>[0],
  entity: Entity,
  view: FormView,
  record: DataRecord,
  records: DataRecord[],
) {
  // What the visitor gave and what the business shows them: the form's own fields (no pictures), plus the
  // booked resource, time and amounts. Never the team's other fields.
  const asked = new Set(
    publicFieldsOf(bp, view)
      .filter((f) => f.type !== "image")
      .map((f) => f.id),
  );
  const b = entity.booking;
  return entity.fields
    .filter(
      (f) =>
        (asked.has(f.id) ||
          f.id === b?.resourceFieldId ||
          f.id === b?.timeFieldId ||
          f.type === "money" ||
          (f.type === "formula" && f.formula?.resultType === "money")) &&
        record.data[f.id] !== undefined &&
        record.data[f.id] !== null &&
        record.data[f.id] !== "",
    )
    .map((f) => ({ name: f.name, text: formatCell(bp, records, f, record.data[f.id]).text }))
    .filter((s) => s.text);
}

async function load(claim: ManageClaim) {
  const doc = await readCurrent(db, claim.workspace);
  if (!doc || doc.meta.setup) return null;
  const bp = doc.blueprint;
  const view = bp.views.find((v) => v.id === claim.view);
  if (view?.type !== "form" || !view.public) return null;
  const entity = bp.entities.find((e) => e.id === view.entityId);
  const record = doc.records.find((r) => r.id === claim.record && r.entityId === view.entityId);
  if (!entity || !record) return null;
  return { doc, bp, view, entity, record };
}

export async function managedBooking(token: string): Promise<ManagedBooking | Problem> {
  const claim = readManageToken(token);
  if (!claim) return GONE;
  const found = await load(claim);
  if (!found) return GONE;
  const { doc, bp, view, entity, record } = found;
  const statusField =
    entity.fields.find((f) => f.id === entity.booking?.statusFieldId) ??
    entity.fields.find((f) => f.type === "status");
  const option = statusField ? optionOf(statusField, record.data[statusField.id]) : undefined;
  return {
    ok: true,
    site: siteOf(claim.workspace, doc.meta.name, bp)?.name ?? doc.meta.name,
    // A booking a visitor made without a name reads as the record type ("Booking"), not "Untitled".
    title: ((t) => (t && t !== "Untitled" ? t : entity.name))(recordTitle(entity, record)),
    reference:
      autoReferenceFields(entity)
        .map((f) => record.data[f.id])
        .find((v): v is string => typeof v === "string" && !!v) ?? record.id.slice(-6).toUpperCase(),
    ...(option ? { status: { label: option.label, tone: option.tone } } : {}),
    summary: shown(bp, entity, view, record, doc.records),
    attach: publicFieldsOf(bp, view)
      .filter((f) => f.type === "image")
      .map((f) => ({ fieldId: f.id, name: f.name, added: isImagePath(record.data[f.id]) })),
  };
}

/**
 * Adds a picture to the booking a token names: only into an image field its form asks for, checked as a real
 * picture, and saved like any other write (the workspace row locked, the record's rev bumped so open tabs merge it).
 */
export async function attachToBooking(
  token: string,
  fieldId: string,
  bytes: Uint8Array,
): Promise<{ ok: true; booking: ManagedBooking } | Problem> {
  const claim = readManageToken(token);
  if (!claim) return GONE;
  const found = await load(claim);
  if (!found) return GONE;
  if (!publicFieldsOf(found.bp, found.view).some((f) => f.id === fieldId && f.type === "image"))
    return { ok: false, status: 403, message: "This booking doesn't take that picture." };
  const url = await saveImage(claim.workspace, bytes);
  if (!url)
    return { ok: false, status: 415, message: "Upload a photo or screenshot (PNG, JPG, WebP or GIF)." };
  let hooks = 0;
  const saved = await db.transaction().execute(async (trx) => {
    await sql`select 1 from workspace where id = ${claim.workspace} for update`.execute(trx);
    if (!(await currentBlueprint(trx, claim.workspace))) return false;
    const stored = (await readRecords(trx, claim.workspace)).find((s) => s.record.id === claim.record);
    if (!stored) return false;
    const record = {
      ...stored.record,
      data: { ...stored.record.data, [fieldId]: url },
      updatedAt: new Date().toISOString(),
    };
    const put = await putRecords(trx, claim.workspace, [{ record, rev: stored.rev }], {
      type: "booking_link",
      name: "Booking link",
    });
    if (put.conflicts.length) return false;
    hooks = await queueChanges(trx, claim.workspace, found.bp, [{ before: stored.record, after: record }]);
    await logActivity(
      trx,
      { type: "booking_link", name: "Booking link" },
      {
        workspaceId: claim.workspace,
        action: "record.update",
        target: record.entityId,
        ids: [record.id],
        detail: `Added a picture (${fieldId})`,
      },
    );
    await sql`update workspace set updated_at = now() where id = ${claim.workspace}`.execute(trx);
    return true;
  });
  if (!saved) return { ok: false, status: 409, message: "Couldn't save it just now. Try again." };
  sendSoon(hooks);
  const booking = await managedBooking(token);
  return booking.ok ? { ok: true, booking } : booking;
}
