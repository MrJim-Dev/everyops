"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import type { RecordData } from "@/lib/blueprint/types";
import { RecordFormDialog } from "./record-form-dialog";
import { RecordSheet } from "./record-sheet";

type Panels = {
  openRecord: (id: string) => void;
  /** returnTo: the record to show again once it's created (adding a line item keeps its parent open). */
  openCreate: (entityId: string, prefill?: RecordData, options?: { returnTo?: string }) => void;
};

const PanelsContext = createContext<Panels | null>(null);

/** One record panel and one create dialog per workspace, opened from any view. */
export function RecordPanelsProvider({ children }: { children: ReactNode }) {
  const [recordId, setRecordId] = useState<string | null>(null);
  const [create, setCreate] = useState<{ entityId: string; prefill: RecordData; key: number } | null>(null);

  const openRecord = useCallback((id: string) => setRecordId(id), []);
  const openCreate = useCallback(
    (entityId: string, prefill: RecordData = {}, options: { returnTo?: string } = {}) => {
      setReturnTo(options.returnTo);
      setCreate({ entityId, prefill, key: Date.now() });
    },
    [],
  );
  const value = useMemo(() => ({ openRecord, openCreate }), [openRecord, openCreate]);
  // Adding a line item from a record's panel brings that record back once the line is created.
  const [returnTo, setReturnTo] = useState<string | undefined>();

  return (
    <PanelsContext.Provider value={value}>
      {children}
      <RecordSheet recordId={recordId} onClose={() => setRecordId(null)} />
      {create ? (
        <RecordFormDialog
          key={create.key}
          entityId={create.entityId}
          prefill={create.prefill}
          onClose={() => setCreate(null)}
          onCreated={(id) => {
            setCreate(null);
            setRecordId(returnTo ?? id);
          }}
        />
      ) : null}
    </PanelsContext.Provider>
  );
}

export function useRecordPanels(): Panels {
  const value = useContext(PanelsContext);
  if (!value) throw new Error("useRecordPanels must be used inside RecordPanelsProvider");
  return value;
}
