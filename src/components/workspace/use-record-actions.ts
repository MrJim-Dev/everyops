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
  };
}
