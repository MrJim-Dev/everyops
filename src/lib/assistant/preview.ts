import type { WorkspaceData } from "@/lib/blueprint/types";

const SCREEN: Record<string, string> = {
  slot_grid: "Schedule",
  checkout: "Register",
  approval_queue: "Approvals",
  kanban: "Board",
  calendar: "Calendar",
};

/** What a new workspace will contain, in plain words, before it's created. */
export function blueprintPreview(data: WorkspaceData): { label: string; detail: string }[] {
  const bp = data.blueprint;
  return [
    ...bp.entities.map((e) => {
      const count = data.records.filter((r) => r.entityId === e.id).length;
      // Say when fields are left out, so a revision doesn't look like it dropped them.
      const names = e.fields
        .filter((f) => f.type !== "rollup" && f.type !== "formula" && f.id !== e.primaryFieldId)
        .map((f) => f.name);
      const fields = `${names.slice(0, 8).join(", ")}${names.length > 8 ? `, +${names.length - 8} more` : ""}`;
      return {
        label: e.pluralName,
        detail: e.resource
          ? `${count} ${e.pluralName.toLowerCase()}, open ${e.resource.opensAt}–${e.resource.closesAt}, ${e.resource.slotMinutes}-minute slots`
          : `${fields}${count ? ` · ${count} sample ${count === 1 ? "record" : "records"}` : ""}`,
      };
    }),
    {
      label: "Screens",
      detail: bp.views
        .map((v) => (v.type === "table" ? v.name : `${v.name} (${SCREEN[v.type] ?? v.type})`))
        .join(", "),
    },
    { label: "Dashboard", detail: bp.widgets.map((w) => w.title).join(", ") || "None" },
    ...(bp.rules.length ? [{ label: "Automations", detail: bp.rules.map((r) => r.name).join(", ") }] : []),
  ];
}
