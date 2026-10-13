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
import { useWorkspace } from "./workspace-context";

/** Record mutations bound to the current workspace. Rule notices become toasts. */
export function useRecordActions() {
  const ws = useWorkspace();
  const { data, commit } = ws;

  const settle = useCallback(
    (result: MutationResult) => {
      if (result.ok) {
        commit(result.data);
        for (const notice of result.notices) toast(notice);
      }
      return result;
    },
    [commit],
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
        const before = data;
        commit(deleteRecord(data, id));
        toast(`${label} deleted`, {
          action: { label: "Undo", onClick: () => commit(before) },
          duration: 10_000,
        });
      },
      [data, commit],
    ),
    createWithLines: useCallback(
      (parentEntityId: string, parent: RecordData, lineEntityId: string, lines: RecordData[]) =>
        settle(createWithLines(data, parentEntityId, parent, lineEntityId, lines)),
      [data, settle],
    ),
  };
}
