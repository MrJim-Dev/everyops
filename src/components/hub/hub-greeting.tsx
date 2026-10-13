"use client";

import { useMounted } from "@/hooks/use-mounted";
import { useCurrentUser } from "@/lib/auth/client";
import { TIME_ZONE } from "@/lib/time";

const hourFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  hourCycle: "h23",
});

function partOfDay(date: Date) {
  const hour = Number(hourFormat.format(date));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * "Good evening, James" in Manila time. The home page is prerendered, so the clock is read
 * only after mount; until then the line keeps its height so nothing shifts.
 */
export function HubGreeting() {
  const mounted = useMounted();
  const user = useCurrentUser();
  const first = user?.name.trim().split(/\s+/)[0];
  return (
    <p className="h-5 text-[13.5px] text-muted-foreground">
      {mounted ? `${partOfDay(new Date())}${first ? `, ${first}` : ""}` : null}
    </p>
  );
}
