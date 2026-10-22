"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import type { RecordData } from "@/lib/blueprint/types";
import {
  createRecord,
  createWithLines,
  deleteRecord,
  type MutationResult,
  updateRecord,
} from "@/lib/engine/records";
import { createSeries, type Repeat, type SeriesResult, updateFollowing } from "@/lib/engine/recurrence";
import { markFresh } from "@/lib/motion/fresh";
import { canEdit } from "@/lib/store/workspaces";
import { useWorkspace } from "./workspace-context";

/** Record mutations bound to the current workspace. Rule notices become toasts. */
export function useRecordActions() {
  const ws = useWorkspace();
  const { data, commit } = ws;

  const readOnly = !canEdit(ws.role);
  const settle = useCallback(
    (result: MutationResult): MutationResult => {
      if (readOnly) {
        toast.warning("You have view-only access", { description: "Ask an admin to change your role." });
        return { ok: false, errors: [{ message: "You have view-only access to this workspace." }] };
      }
      if (result.ok) {
        commit(result.data);
        markFresh([result.record.id]);
        for (const notice of result.notices) toast.info(notice);
      }
      return result;
    },
    [commit, readOnly],
  );

  return {
    create: useCallback(
      (entityId: string, input: RecordData) => settle(createRecord(data, entityId, input)),
      [data, settle],
    ),
    update: useCallback(
      (id: string, patch: RecordData) => settle(updateRecord(data, id, patch)),
      [data, settle],
    ),
    remove: useCallback(
      (id: string, label = "Record") => {
        if (readOnly) {
          toast.warning("You have view-only access");
          return;
        }
        const before = data;
        commit(deleteRecord(data, id));
        toast.success(`${label} deleted`, {
          action: { label: "Undo", onClick: () => commit(before) },
          duration: 10_000,
        });
      },
      [data, commit, readOnly],
    ),
    createWithLines: useCallback(
      (parentEntityId: string, parent: RecordData, lineEntityId: string, lines: RecordData[]) =>
        settle(createWithLines(data, parentEntityId, parent, lineEntityId, lines)),
      [data, settle],
    ),
    /** A record, or a series of them when it repeats (src/lib/engine/recurrence.ts). Days that clash are skipped. */
    createSeries: useCallback(
      (entityId: string, input: RecordData, repeat: Repeat | null, noun: { one: string; many: string }) => {
        const result: SeriesResult = createSeries(data, entityId, input, repeat);
        // One record (or a refusal) goes through the usual path: view-only check, commit, notices.
        if (readOnly || !result.ok || result.ids.length < 2) {
          const settled = settle(result);
          return settled.ok && result.ok ? result : settled;
        }
        const before = data;
        commit(result.data);
        markFresh(result.ids);
        for (const notice of result.notices) toast.info(notice);
        toast.success(`Created ${result.ids.length} ${noun.many}`, {
          description: result.skipped.length
            ? `Skipped ${result.skipped.length} that clashed with another ${noun.one}.`
            : undefined,
          action: { label: "Undo", onClick: () => commit(before) },
          duration: 10_000,
        });
        return result;
      },
      [data, commit, settle, readOnly],
    ),
    /** An edit to a record and the rest of its series after it, saved together. */
    updateFollowing: useCallback(
      (id: string, patch: RecordData) => {
        const record = data.records.find((r) => r.id === id);
        if (readOnly || !record) return settle(updateRecord(data, id, patch));
        const result = updateFollowing(data, record, patch);
        if (!result.ok) return result;
        const before = data;
        commit(result.data);
        markFresh(result.ids);
        for (const notice of result.notices) toast.info(notice);
        toast.success(`Updated ${result.ids.length} in this series`, {
          action: { label: "Undo", onClick: () => commit(before) },
        });
        return result;
      },
      [data, commit, settle, readOnly],
    ),
    /** The same change on several records, saved together. Stops at the first record that fails its checks. */
    updateMany: useCallback(
      (ids: string[], patch: RecordData): { ok: true; count: number } | { ok: false; message: string } => {
        if (readOnly) {
          toast.warning("You have view-only access");
          return { ok: false, message: "You have view-only access to this workspace." };
        }
        let next = data;
        const notices: string[] = [];
        for (const id of ids) {
          const result = updateRecord(next, id, patch);
          if (!result.ok) return { ok: false, message: result.errors[0]?.message ?? "Couldn't update" };
          next = result.data;
          notices.push(...result.notices);
        }
        const before = data;
        commit(next);
        markFresh(ids);
        for (const notice of new Set(notices)) toast.info(notice);
        toast.success(`Updated ${ids.length} ${ids.length === 1 ? "record" : "records"}`, {
          action: { label: "Undo", onClick: () => commit(before) },
        });
        return { ok: true, count: ids.length };
      },
      [data, commit, readOnly],
    ),
    /** Deletes several records at once, with one Undo. */
    removeMany: useCallback(
      (ids: string[], noun: string) => {
        if (readOnly) {
          toast.warning("You have view-only access");
          return;
        }
        const before = data;
        commit(ids.reduce((ws, id) => deleteRecord(ws, id), data));
        toast.success(`Deleted ${ids.length} ${noun}`, {
          action: { label: "Undo", onClick: () => commit(before) },
          duration: 10_000,
        });
      },
      [data, commit, readOnly],
    ),
  };
}
