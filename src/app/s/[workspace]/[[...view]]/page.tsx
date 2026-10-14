import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PublicSiteView } from "@/components/public/public-site";
import { publicPage } from "@/server/public";

type Props = PageProps<"/s/[workspace]/[[...view]]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { workspace, view } = await params;
  const found = await publicPage(workspace, view?.[0]);
  if (!found) return { title: "Page not found" };
  const home = found.page.id === found.site.pages[0]?.id;
  const title =
    found.page.type === "landing" || (found.page.type === "html" && home)
      ? found.site.name
      : `${found.page.name} · ${found.site.name}`;
  return { title: { absolute: title } };
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
  if (view && view.length > 1) notFound();
  const found = await publicPage(workspace, view?.[0]);
  if (!found) notFound();
  return <PublicSiteView site={found.site} page={found.page} />;
}
