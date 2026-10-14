import type { ChangeEntry } from "@/lib/store/workspace-model";
import { TIME_ZONE } from "@/lib/time";

export type HistoryItem = { kind: "entry"; entry: ChangeEntry } | { kind: "run"; entries: ChangeEntry[] };
export type HistoryDay = { key: string; label: string; items: HistoryItem[] };

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });
const dayLabel = new Intl.DateTimeFormat("en-PH", {
  timeZone: TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
});
const dayLabelYear = new Intl.DateTimeFormat("en-PH", {
  timeZone: TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** "Today", "Yesterday" or "Tue, Oct 13" (with the year when it isn't this one), in Manila time. */
export function historyDayLabel(iso: string, now = new Date()): string {
  const key = dayKey.format(new Date(iso));
  if (key === dayKey.format(now)) return "Today";
  if (key === dayKey.format(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return (key.slice(0, 4) === dayKey.format(now).slice(0, 4) ? dayLabel : dayLabelYear).format(new Date(iso));
}

/**
 * History newest first, by day. Two or more changes in a row that were all undone become one run, so attempts that
 * didn't stick fold away; a single undone change stays on its own. A run sits under the day of its newest change.
 */
export function groupHistory(changes: ChangeEntry[], now = new Date()): HistoryDay[] {
  const items: HistoryItem[] = [];
  for (let i = 0; i < changes.length; ) {
    let end = i;
    while (end < changes.length && changes[end].undoneAt) end++;
    if (end - i >= 2) {
      items.push({ kind: "run", entries: changes.slice(i, end) });
      i = end;
    } else {
      items.push({ kind: "entry", entry: changes[i] });
      i++;
    }
  }
  const days: HistoryDay[] = [];
  for (const item of items) {
    const first = item.kind === "run" ? item.entries[0] : item.entry;
    const key = dayKey.format(new Date(first.appliedAt));
    const day = days.at(-1);
    if (day?.key === key) day.items.push(item);
    else days.push({ key, label: historyDayLabel(first.appliedAt, now), items: [item] });
  }
  return days;
}
