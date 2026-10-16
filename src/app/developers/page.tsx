import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/shell/site-nav";
import { openapi, operations } from "@/lib/api/openapi";

export const metadata: Metadata = {
  title: "API reference",
  description: "Read and write your EveryOps records from scripts, integrations and AI agents.",
};

const METHOD_STYLE: Record<string, string> = {
  get: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  post: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  patch: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  put: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  delete: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const BASE = openapi.servers[0].url;

/** A ready-to-run curl line for an operation, with the demo values a reader replaces. */
function example(o: (typeof operations)[number]) {
  const path = o.path
    .replace("{id}", "my-workspace")
    .replace("{recordId}", "booking_47eac757d5")
    .replace("{viewId}", "house_rules");
  const query =
    o.operationId === "listRecords"
      ? "?type=bookings&filter=status:eq:Confirmed&limit=10"
      : o.operationId === "aggregate"
        ? "?type=bookings&metric=sum&field=total_amount&groupBy=court"
        : o.operationId === "deleteRecord"
          ? "?rev=2"
          : "";
  const body: Record<string, string> = {
    createRecord:
      '{"type":"bookings","values":{"player":"Lia Santos","court":"Court 1","slot":{"start":"2026-10-20 20:00","end":"2026-10-20 21:00"}}}',
    updateRecord: '{"values":{"status":"Confirmed"},"rev":1}',
    putPage: '{"text":"# House rules\\n\\nNon-marking shoes only."}',
    proposeChange: '{"request":"Add a deposit field to bookings"}',
  };
  const lines = [
    `curl${o.method === "get" ? "" : ` -X ${o.method.toUpperCase()}`} "${BASE}${path}${query}"`,
    '  -H "Authorization: Bearer $EVERYOPS_API_KEY"',
  ];
  if (body[o.operationId])
    lines.push('  -H "Content-Type: application/json"', `  -d '${body[o.operationId]}'`);
  return lines.join(" \\\n");
}

const Code = ({ children }: { children: string }) => (
  <pre className="overflow-x-auto rounded-lg border bg-muted/40 px-4 py-3 font-mono text-[12px] leading-relaxed text-foreground/90">
    {children}
  </pre>
);

export default function Page() {
  const tags = openapi.tags.map((t) => ({ ...t, ops: operations.filter((o) => o.tags.includes(t.name)) }));
  return (
    <div className="min-h-dvh bg-shell">
      <SiteNav variant="page" />
      <div className="mx-auto flex max-w-[1080px] gap-10 px-5 pt-12 pb-24">
        <nav
          aria-label="Endpoints"
          className="sticky top-20 hidden h-fit w-52 shrink-0 flex-col gap-4 text-[13px] lg:flex"
        >
          <a href="#start" className="font-medium text-foreground">
            Getting started
          </a>
          {tags.map((t) => (
            <div key={t.name} className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">
                {t.name}
              </span>
              {t.ops.map((o) => (
                <a
                  key={o.operationId}
                  href={`#${o.operationId}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {o.summary}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <main className="min-w-0 flex-1 animate-rise">
          <h1 className="text-[28px] font-semibold tracking-tight">{openapi.info.title}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Version {openapi.info.version} ·{" "}
            <a href="/api/v1/openapi.json" className="underline underline-offset-2 hover:text-foreground">
              openapi.json
            </a>{" "}
            · MCP server at <code className="font-mono">https://everyops.app/mcp</code>
          </p>
          <p className="mt-6 text-[14.5px] leading-relaxed text-foreground/90">{openapi.info.description}</p>

          <section
            id="start"
            className="mt-10 flex scroll-mt-20 flex-col gap-4 text-[14.5px] leading-relaxed text-foreground/90"
          >
            <h2 className="text-[18px] font-semibold text-foreground">Getting started</h2>
            <p>
              Make a key in{" "}
              <Link href="/account" className="underline underline-offset-2">
                Account → API keys
              </Link>
              , choose its workspaces and permissions, and send it as a bearer token. A key never does more
              than you can in a workspace, and a workspace outside its list answers 404.
            </p>
            <Code>{`curl ${BASE}/workspaces -H "Authorization: Bearer $EVERYOPS_API_KEY"`}</Code>
            <ul className="flex list-disc flex-col gap-1.5 pl-5">
              <li>
                Responses are <code className="font-mono text-[13px]">{"{ data, meta? }"}</code>; errors are{" "}
                <code className="font-mono text-[13px]">{"{ error: { code, message, details? } }"}</code>.
              </li>
              <li>
                Lists return 25 records a page (up to 50). Pass{" "}
                <code className="font-mono text-[13px]">meta.nextCursor</code> as{" "}
                <code className="font-mono text-[13px]">cursor</code> for the next one.
              </li>
              <li>
                Records carry a <code className="font-mono text-[13px]">rev</code>. Send it back when you
                change or delete one; if someone saved it since, you get 409 with the record as it is now.
              </li>
              <li>Each key may make 120 requests a minute; past that you get 429 with Retry-After.</li>
              <li>v1 only gains endpoints and fields. Anything that would break a client goes in /api/v2.</li>
            </ul>
            <p>
              The TypeScript client in <code className="font-mono text-[13px]">src/lib/api/client.ts</code>{" "}
              has no dependencies and one method per endpoint:
            </p>
            <Code>{`const eo = new EveryOps(process.env.EVERYOPS_API_KEY);
for await (const booking of eo.allRecords("my-workspace", { type: "bookings", filter: ["status:eq:Pending"] }))
  await eo.updateRecord("my-workspace", booking.id, { status: "Confirmed" }, booking.rev);`}</Code>
          </section>

          {tags.map((t) => (
            <section key={t.name} className="mt-12 flex flex-col gap-8">
              <div>
                <h2 className="text-[18px] font-semibold">{t.name}</h2>
                <p className="text-[13.5px] text-muted-foreground">{t.description}</p>
              </div>
              {t.ops.map((o) => (
                <article
                  key={o.operationId}
                  id={o.operationId}
                  className="flex scroll-mt-20 flex-col gap-3 border-t pt-6"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase ${METHOD_STYLE[o.method]}`}
                    >
                      {o.method}
                    </span>
                    <code className="font-mono text-[13px]">{o.path}</code>
                    <span className="ml-auto rounded-full border px-2 text-[11px] leading-5 text-muted-foreground">
                      {o["x-permission"]}
                    </span>
                  </div>
                  <h3 className="text-[15px] font-semibold">{o.summary}</h3>
                  {o.description ? (
                    <p className="text-[14px] leading-relaxed text-foreground/85">{o.description}</p>
                  ) : null}
                  {o.parameters?.some((p) => p.in === "query") ? (
                    <table className="w-full text-left text-[13px]">
                      <tbody>
                        {o.parameters
                          .filter((p) => p.in === "query")
                          .map((p) => (
                            <tr key={p.name} className="border-b last:border-b-0">
                              <td className="w-32 py-1.5 pr-3 align-top font-mono text-[12.5px]">
                                {p.name}
                                {p.required ? <span className="text-destructive">*</span> : null}
                              </td>
                              <td className="py-1.5 text-muted-foreground">{p.description}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  ) : null}
                  <Code>{example(o)}</Code>
                  <p className="text-[12.5px] text-muted-foreground">
                    {Object.entries(o.responses)
                      .filter(([s]) => !["400", "401", "403", "404", "429"].includes(s))
                      .map(([s, r]) => `${s} ${(r as { description: string }).description.toLowerCase()}`)
                      .join(" · ")}
                    {" · errors 400, 401, 403, 404, 429"}
                  </p>
                </article>
              ))}
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
