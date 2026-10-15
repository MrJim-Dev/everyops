import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PublicSiteView } from "@/components/public/public-site";
import { pageMeta } from "@/lib/public/bindings";
import { type PublicPageData, sitePath } from "@/lib/public/resolve";
import { publicPage } from "@/server/public";

type Props = PageProps<"/s/[workspace]/[[...view]]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { workspace, view } = await params;
  const found = await publicPage(workspace, view?.[0]);
  if (!found) return { title: "Page not found" };
  if ("redirect" in found) return {};
  const home = found.page.id === found.site.pages[0]?.id;
  const fallback =
    found.page.type === "landing" || (found.page.type === "html" && home)
      ? found.site.name
      : `${found.page.name} · ${found.site.name}`;
  if (found.page.type !== "html" || !found.page.html) return { title: { absolute: fallback } };
  // A custom page draws in its frame, so search engines and link previews get its own title, description and picture.
  const meta = pageMeta(found.page.html);
  const title = meta.title || fallback;
  return {
    title: { absolute: title },
    ...(meta.description ? { description: meta.description } : {}),
    openGraph: {
      title,
      siteName: found.site.name,
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.image ? { images: [meta.image] } : {}),
    },
  };
}

/** A workspace's public pages: its landing page and public forms. No account needed. */
export default function Page({ params }: Props) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-shell" />}>
      <PublicRoute params={params} />
    </Suspense>
  );
}

async function PublicRoute({ params }: { params: Props["params"] }) {
  const { workspace, view } = await params;
  if (view && view.length > 2) notFound();
  const found = await publicPage(workspace, view?.[0]);
  if (!found) notFound();
  // A booking form with its own custom page: visitors always land on that page.
  if ("redirect" in found) redirect(sitePath(workspace, found.redirect));
  // /s/site/page/RECORD: a custom HTML page showing one record (data-everyops-record). Other pages have no details.
  const recordId = view?.[1] ? decodeURIComponent(view[1]).slice(0, 120) : undefined;
  if (recordId && found.page.type !== "html") notFound();
  return (
    <>
      <PublicSiteView site={found.site} page={found.page} recordId={recordId} />
      {found.page.type === "html" ? <PageText page={found.page} /> : null}
    </>
  );
}

/** The words of a custom page, for visitors and crawlers without JavaScript (the page itself draws in its frame). */
function PageText({ page }: { page: PublicPageData }) {
  const meta = pageMeta(page.html ?? "");
  const listed = page.listed ?? [];
  return (
    <noscript>
      <main>
        {meta.headings.map((h, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static text in page order
          <h2 key={i}>{h}</h2>
        ))}
        {meta.paragraphs.map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static text in page order
          <p key={i}>{p}</p>
        ))}
        {listed.length ? (
          <ul>
            {listed.map((o, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static text in page order
              <li key={i}>{o}</li>
            ))}
          </ul>
        ) : null}
      </main>
    </noscript>
  );
}
