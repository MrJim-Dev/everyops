import {
  CalendarBlankIcon,
  GaugeIcon,
  GridFourIcon,
  ReceiptIcon,
  SparkleIcon,
  UsersIcon,
} from "@phosphor-icons/react/ssr";
import { LogoMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

const COURTS = ["Court 1", "Court 2", "Court 3", "Court 4"];
const HOURS = ["8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM"];

type Tone = "teal" | "blue" | "amber" | "neutral";
const TONES: Record<Tone, string> = {
  teal: "border-primary bg-primary/12",
  blue: "border-chart-4 bg-chart-4/12",
  amber: "border-warning bg-warning/10",
  neutral: "border-foreground/30 bg-foreground/[0.04]",
};

const BOOKINGS: { court: number; start: number; span: number; who: string; time: string; tone: Tone }[] = [
  { court: 0, start: 0, span: 1, who: "Reyes", time: "8–9 AM", tone: "teal" },
  { court: 1, start: 1, span: 2, who: "Cebu Smash Club", time: "9–11 AM", tone: "blue" },
  { court: 2, start: 0, span: 1, who: "Tan", time: "8–9 AM", tone: "neutral" },
  { court: 3, start: 2, span: 1, who: "Lim family", time: "10–11 AM", tone: "amber" },
  { court: 0, start: 3, span: 2, who: "Open play", time: "11 AM–1 PM", tone: "teal" },
  { court: 2, start: 4, span: 1, who: "Santos", time: "12–1 PM", tone: "blue" },
  { court: 1, start: 5, span: 1, who: "Garcia", time: "1–2 PM", tone: "neutral" },
  { court: 3, start: 5, span: 2, who: "Clinic, Coach Bea", time: "1–3 PM", tone: "teal" },
];

const NAV = [
  { label: "Overview", icon: GaugeIcon },
  { label: "Bookings", icon: CalendarBlankIcon, active: true },
  { label: "Courts", icon: GridFourIcon },
  { label: "Players", icon: UsersIcon },
  { label: "Payments", icon: ReceiptIcon },
];

/**
 * The hero's product shot, drawn in markup so it stays sharp and on-brand.
 * Decorative: the sr-only line says what it shows.
 */
export function ProductStage() {
  return (
    <div className="relative mx-auto mt-16 w-full max-w-[1080px] sm:mt-20">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[10%] top-[8%] h-[70%] rounded-full bg-primary/20 blur-[110px]"
      />
      <p className="sr-only">
        A court booking system built by EveryOps: a day schedule for four courts, with a new booking and a
        pricing change waiting to be applied.
      </p>
      <div aria-hidden="true" className="stage-tilt relative select-none">
        <Window />
        <FloatCard className="-left-14 top-[42%] w-[236px]" depth={0.7}>
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-chart-4/15 text-[11px] font-semibold text-chart-4">
              AL
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium">Andrea Lim booked Court 2</p>
              <p className="text-[11.5px] text-muted-foreground">Today, 6–7 PM · ₱500</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between border-t pt-2.5 text-[11px]">
            <span className="text-muted-foreground">Paid at the counter</span>
            <span className="rounded-full bg-primary/12 px-2 py-0.5 text-primary">Confirmed</span>
          </div>
        </FloatCard>
        <FloatCard className="-right-16 top-[30%] w-[268px]" depth={1}>
          <p className="flex items-center gap-1.5 text-[11.5px] text-primary">
            <SparkleIcon weight="fill" className="size-3.5" />
            Change ready to apply
          </p>
          <p className="mt-1.5 text-[13px] font-medium">Raise weekend court rates</p>
          <div className="mt-3 flex items-center justify-between rounded-lg bg-background/70 px-3 py-2 text-[12px]">
            <span className="text-muted-foreground">Weekend rate</span>
            <span className="tabular">
              <span className="text-muted-foreground line-through">₱450</span>
              <span className="mx-1.5 text-muted-foreground">to</span>
              <span className="font-medium">₱600</span>
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>New bookings only · undoable</span>
            <span className="rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground">Apply</span>
          </div>
        </FloatCard>
        <FloatCard className="-right-6 bottom-[8%] w-[200px]" depth={0.4}>
          <p className="text-[11.5px] text-muted-foreground">Revenue this week</p>
          <p className="mt-1 text-[20px] font-semibold tracking-tight tabular">₱96,250</p>
          <svg aria-hidden="true" viewBox="0 0 100 28" className="mt-2 h-7 w-full" preserveAspectRatio="none">
            <polyline
              fill="none"
              stroke="var(--primary)"
              strokeWidth="1.6"
              strokeLinejoin="round"
              points="0,22 14,19 28,21 42,13 56,15 70,8 84,10 100,3"
            />
          </svg>
        </FloatCard>
      </div>
      <div className="pointer-events-none absolute inset-x-0 -bottom-px h-40 bg-gradient-to-t from-shell to-transparent" />
    </div>
  );
}

function FloatCard({
  className,
  depth,
  children,
}: {
  className: string;
  depth: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{ "--depth": depth } as React.CSSProperties}
      className={cn(
        "parallax absolute z-10 hidden rounded-xl border border-foreground/10 bg-popover/85 p-3.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl lg:block",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Window() {
  return (
    <div className="overflow-hidden rounded-2xl border border-foreground/10 bg-background shadow-[0_50px_140px_-40px_rgba(0,0,0,0.9)] ring-1 ring-black/40">
      <div className="flex h-11 items-center gap-3 border-b px-4 text-[12px]">
        <LogoMark className="size-3.5 text-primary" />
        <span className="font-medium">Court House PH</span>
        <span className="text-muted-foreground">/ Bookings</span>
        <span className="ml-auto hidden text-muted-foreground sm:inline">Tue, 13 Oct</span>
        <span className="rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground">
          New booking
        </span>
      </div>
      <div className="flex">
        <div className="hidden w-[180px] shrink-0 flex-col gap-0.5 border-r bg-shell/60 p-2.5 md:flex">
          {NAV.map(({ label, icon: Glyph, active }) => (
            <span
              key={label}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground",
                active && "bg-secondary text-foreground",
              )}
            >
              <Glyph className="size-3.5" />
              {label}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1 p-4">
          <div className="mb-4 grid grid-cols-3 gap-3">
            {[
              ["Bookings today", "14"],
              ["Revenue today", "₱18,400"],
              ["Courts in use", "72%"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border bg-card/60 px-3 py-2.5">
                <p className="truncate text-[11px] text-muted-foreground">{label}</p>
                <p className="mt-0.5 text-[16px] font-semibold tracking-tight tabular">{value}</p>
              </div>
            ))}
          </div>
          <Schedule />
        </div>
      </div>
    </div>
  );
}

function Schedule() {
  return (
    <div className="relative grid grid-cols-[44px_repeat(4,minmax(0,1fr))] grid-rows-[26px_repeat(8,38px)] text-[11px]">
      {COURTS.map((court, c) => (
        <span key={court} className="self-center px-2 text-muted-foreground" style={{ gridColumn: c + 2 }}>
          {court}
        </span>
      ))}
      {HOURS.map((hour, h) => (
        <span
          key={hour}
          className="pt-1 text-[10px] text-muted-foreground"
          style={{ gridRow: h + 2, gridColumn: 1 }}
        >
          {hour}
        </span>
      ))}
      {HOURS.flatMap((hour, h) =>
        COURTS.map((court, c) => (
          <span
            key={`${hour}-${court}`}
            className="border-t border-l border-border/60"
            style={{ gridRow: h + 2, gridColumn: c + 2 }}
          />
        )),
      )}
      {BOOKINGS.map((b) => (
        <span
          key={`${b.court}-${b.start}`}
          className={cn(
            "m-[3px] overflow-hidden rounded-md border-l-2 px-2 py-1.5 leading-tight",
            TONES[b.tone],
          )}
          style={{ gridColumn: b.court + 2, gridRow: `${b.start + 2} / span ${b.span}` }}
        >
          <span className="block truncate font-medium">{b.who}</span>
          <span className="block truncate text-[10px] text-muted-foreground">{b.time}</span>
        </span>
      ))}
      <span
        className="relative z-10 mt-[22px] h-px self-start bg-primary"
        style={{ gridRow: 6, gridColumn: "2 / -1" }}
      >
        <span className="absolute -top-[3px] -left-1 size-[7px] animate-live rounded-full bg-primary" />
      </span>
    </div>
  );
}
