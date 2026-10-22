"use client";

import { useState } from "react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { Entity } from "@/lib/blueprint/types";
import { ADDED_BY, accessLabel } from "@/lib/engine/access";
import { useWorkspaces } from "@/lib/store/workspaces";

const ALL = "";

/** The choices for one record type: everyone sees all, or staff and viewers only theirs (by a field or who added it). */
function choices(entity: Entity) {
  const plural = entity.pluralName.toLowerCase();
  return [
    { value: ALL, label: `All ${plural}` },
    { value: ADDED_BY, label: `Only the ${plural} they added` },
    ...entity.fields
      .filter((f) => f.type === "person" || f.type === "email")
      .map((f) => ({ value: f.id, label: `Only the ${plural} assigned to them (${f.name})` })),
  ];
}

/**
 * What staff and viewers see of each record type. Owners and admins always see everything. The server keeps
 * records a member can't see out of everything they read (src/lib/engine/access.ts); changing this is a design
 * change, so History can undo it.
 */
export function RecordAccessSettings({ manager }: { manager: boolean }) {
  const ws = useWorkspace();
  const applyChange = useWorkspaces((s) => s.applyChange);
  const entities = ws.blueprint.entities;
  const current = Object.fromEntries(entities.map((e) => [e.id, e.access?.by ?? ALL]));
  const [picked, setPicked] = useState<Record<string, string>>(current);
  const changed = entities.filter((e) => (picked[e.id] ?? ALL) !== current[e.id]);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!changed.length) return;
    const entry = applyChange(ws.id, {
      request: "Change what staff and viewers see",
      title: "Record access changed",
      facts: [],
      steps: changed.map((e) => ({
        kind: "change" as const,
        label: e.pluralName,
        detail: choices(e).find((c) => c.value === picked[e.id])?.label ?? "",
      })),
      ops: changed.map((e) => ({ op: "set_access" as const, entityId: e.id, by: picked[e.id] || null })),
    });
    if (entry)
      toast.success("Saved what staff and viewers see", { description: "You can undo it from History." });
    else toast.error("Couldn't change what staff and viewers see");
  };

  return (
    <form onSubmit={save}>
      <SettingsSection
        title="What staff and viewers see"
        description="Limit a record type so staff and viewers see only their own records. Owners and admins always see everything."
        footer={
          manager
            ? "Records they can't see stay out of their screens, search, exports, the assistant and the API. Undo it from History."
            : "Only the owner or an admin can change this."
        }
        action={
          manager ? (
            <Button
              type="submit"
              size="sm"
              variant={changed.length ? "default" : "outline"}
              disabled={!changed.length}
            >
              Save
            </Button>
          ) : null
        }
      >
        <ul className="flex flex-col divide-y">
          {entities.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <span className="text-[13px] font-medium">{e.pluralName}</span>
              {manager ? (
                <NativeSelect
                  aria-label={`Who sees ${e.pluralName.toLowerCase()}`}
                  className="w-[380px] max-w-full"
                  value={picked[e.id] ?? ALL}
                  onChange={(event) => setPicked((p) => ({ ...p, [e.id]: event.target.value }))}
                >
                  {choices(e).map((c) => (
                    <NativeSelectOption key={c.value} value={c.value}>
                      {c.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : (
                <span className="text-[13px] text-muted-foreground">
                  {accessLabel(e) ?? `All ${e.pluralName.toLowerCase()}`}
                </span>
              )}
            </li>
          ))}
        </ul>
      </SettingsSection>
    </form>
  );
}
