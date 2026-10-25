import type { Metadata } from "next";
import { PlanPicker } from "@/components/billing/plan-picker";
import { LandingFooter } from "@/components/landing/landing-footer";
import { SiteNav } from "@/components/shell/site-nav";
import { CREDIT_PACKS, formatPeso, LIMIT_ROWS, PUBLIC_PLANS } from "@/lib/billing/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "EveryOps plans in pesos: start free, upgrade when your business needs more workspaces, team and AI.",
};

const CREDIT_EXAMPLES = [
  { what: "Design a new workspace", credits: "about 130" },
  { what: "One setup conversation message", credits: "about 25" },
  { what: "Ask EveryOps a question or for a change", credits: "10 to 60" },
  { what: "Workspace checkup, import matching, voice", credits: "under 20" },
];

const FAQ = [
  {
    q: "How do I pay?",
    a: "Online checkout is coming soon. For now, choose a plan from Account → Plan & usage and the EveryOps team emails you how to pay (GCash, Maya, bank transfer or card), then switches you over.",
  },
  {
    q: "What happens when my AI credits run out?",
    a: "Everything except AI keeps working: your records, pages, bookings and automations. AI comes back on the 1st, or right away when you add a credit pack or upgrade.",
  },
  {
    q: "What if I go over a limit after changing plans?",
    a: "Nothing is deleted. You keep every workspace, record and file, and you can't add more of that thing until you're back under the limit or upgrade.",
  },
  {
    q: "Who uses my credits?",
    a: "AI in your workspaces counts to you as the owner, including what your team asks there. Your team members' own workspaces count to them.",
  },
  {
    q: "Why do you ask me to confirm my email?",
    a: "Free AI credits cost us real money. Confirming your email (or signing in with Google) keeps them for real people instead of throwaway accounts.",
  },
];

/** Public pricing: the plans, the full comparison, what AI credits buy, and how limits behave. */
export default function PricingPage() {
  return (
    <div id="top" className="min-h-dvh overflow-x-clip bg-shell">
      <SiteNav variant="landing" />
      <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-20 px-5 pt-32 pb-24">
        <header className="mx-auto flex max-w-[640px] flex-col items-center gap-4 text-center">
          <h1 className="text-balance text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[52px]">
            Plans that grow with your business
          </h1>
          <p className="text-balance text-[16px] leading-relaxed text-muted-foreground">
            Start free with one system. Pay in pesos when you need more workspaces, a bigger team or more AI.
            No setup fees, cancel any time.
          </p>
        </header>

        <PlanPicker />

        <section className="flex flex-col gap-5" aria-labelledby="compare">
          <h2 id="compare" className="text-[22px] font-semibold tracking-tight">
            Compare plans
          </h2>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[640px] text-[13.5px]">
              <thead>
                <tr className="border-b bg-foreground/[0.02] text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground">Included</th>
                  {PUBLIC_PLANS.map((p) => (
                    <th key={p.id} className="px-4 py-3 font-medium">
                      {p.name}
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        {p.monthlyCentavos ? formatPeso(p.monthlyCentavos) : "₱0"}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LIMIT_ROWS.map((row) => (
                  <tr key={row.key} className="border-b last:border-0">
                    <td className="px-4 py-2.5 text-muted-foreground">{row.label}</td>
                    {PUBLIC_PLANS.map((p) => (
                      <td key={p.id} className="px-4 py-2.5 tabular-nums">
                        {row.show(p.limits)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-8 md:grid-cols-[1fr_1.2fr]" aria-labelledby="credits">
          <div className="flex flex-col gap-3">
            <h2 id="credits" className="text-[22px] font-semibold tracking-tight">
              How AI credits work
            </h2>
            <p className="text-[14.5px] leading-relaxed text-muted-foreground">
              Every plan includes AI credits each month, for setting up workspaces and asking EveryOps to
              answer questions or make changes. Bigger jobs use more credits. They renew on the 1st, and you
              can add more any time:{" "}
              {CREDIT_PACKS.map(
                (p) => `${p.credits.toLocaleString("en-US")} for ${formatPeso(p.centavos)}`,
              ).join(" or ")}
              .
            </p>
            <p className="text-[14.5px] leading-relaxed text-muted-foreground">
              Records, pages, bookings and automations never use credits.
            </p>
          </div>
          <div className="overflow-hidden rounded-xl border">
            {CREDIT_EXAMPLES.map((e) => (
              <div
                key={e.what}
                className="flex justify-between gap-4 border-b px-4 py-3 text-[14px] last:border-0"
              >
                <span>{e.what}</span>
                <span className="shrink-0 font-mono text-[13px] text-muted-foreground">
                  {e.credits} credits
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-5" aria-labelledby="faq">
          <h2 id="faq" className="text-[22px] font-semibold tracking-tight">
            Questions
          </h2>
          <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
            {FAQ.map((f) => (
              <div key={f.q} className="flex flex-col gap-1.5">
                <h3 className="text-[15px] font-medium">{f.q}</h3>
                <p className="text-[14px] leading-relaxed text-muted-foreground">{f.a}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
