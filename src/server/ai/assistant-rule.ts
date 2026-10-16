import type { z } from "zod";
import type { Rule } from "@/lib/blueprint/types";
import { parseScheduleText } from "@/lib/engine/automations";
import type { assistantRule } from "./assistant-prompt";
import { toRule } from "./design";

type AssistantRule = z.infer<typeof assistantRule>;

/**
 * An automation as the assistant wrote it, as a blueprint rule. The answer schema is near Gemini's limit, so the
 * new parts reuse setup's fields: trigger.to holds a schedule's or date's timing, and for send_email fieldId is the
 * recipient, value the subject and message the body; for create_record fieldId is the record type and value the
 * JSON of its values. What doesn't read (an unknown event, a schedule or values that don't parse) is left for
 * validation to name, so the repair round fixes it.
 */
export function toAssistantRule(r: AssistantRule): Rule {
  // Unknown events pass through as written; validation reports them.
  const event = r.trigger.event as Rule["trigger"]["event"];
  const timed = event === "schedule" || event === "date_reached";
  const base = toRule({
    ...r,
    trigger: {
      ...r.trigger,
      event: timed ? "created" : (event as "created" | "updated" | "status_changed"),
      to: timed ? undefined : r.trigger.to,
    },
    actions: r.actions.map((a) => ({
      ...a,
      type: a.type === "set_field" || a.type === "adjust_number" ? a.type : "notify",
    })),
  });
  const { to: _to, ...trigger } = base.trigger;
  return {
    ...base,
    trigger: timed
      ? { ...trigger, event, ...(parseScheduleText(event, r.trigger.to) ?? {}) }
      : { ...base.trigger, event },
    actions: r.actions.map((a, i): Rule["actions"][number] => {
      if (a.type === "send_email") {
        // value is the email: the subject on its first line, then the message (or the message in message).
        const [first = "", ...rest] = (a.value ?? "").split("\n");
        const body = a.message?.trim() ? a.message : rest.join("\n").trim() || first;
        return { type: "send_email", to: a.fieldId ?? "", subject: first.trim(), body };
      }
      if (a.type === "create_record") {
        let values: Record<string, string> = {};
        try {
          const parsed = JSON.parse(a.value ?? "{}") as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
            values = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
        } catch {
          values = {};
        }
        return { type: "create_record", entityId: a.fieldId ?? "", values };
      }
      if (a.type === "link_record")
        return {
          type: "link_record",
          target: { kind: "relation", fieldId: a.target?.fieldId ?? "" },
          fieldId: a.fieldId ?? "",
          value: a.value ?? "",
        };
      if (a.type !== "set_field" && a.type !== "adjust_number" && a.type !== "notify")
        return { type: "notify", message: "" };
      return base.actions[i];
    }),
  };
}
