"use client";

import Link from "next/link";
import type { PublicPageData, PublicSite } from "@/lib/public/resolve";
import { sitePath } from "@/lib/public/resolve";
import { cn } from "@/lib/utils";
import { HtmlPageFrame } from "./html-page-frame";
import { PublicBlocks } from "./public-blocks";
import { PublicFormView } from "./public-form";

/** A workspace's public site: its pages in a simple header, the page's blocks, and a small footer. */
export function PublicSiteView({
  site,
  page,
  preview,
}: {
  site: PublicSite;
  page: PublicPageData;
  preview?: boolean;
}) {
  // A custom HTML page is the whole page: the owner's design, without the site's header and footer.
  if (page.type === "html")
    return (
      <HtmlPageFrame
        html={page.html ?? ""}
        slug={site.slug}
        forms={page.forms ?? []}
        preview={preview}
        title={page.name}
        className={cn("w-full", preview ? "h-full min-h-[480px]" : "h-dvh")}
      />
    );
  return (
    <div className={cn("flex min-h-full flex-col bg-shell", !preview && "min-h-dvh")}>
      <header className="sticky top-0 z-20 border-b bg-shell/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1100px] items-center gap-4 px-5">
          <Link href={sitePath(site.slug)} className="truncate text-[15px] font-semibold tracking-tight">
            {site.name}
          </Link>
          <nav aria-label="Pages" className="ml-auto flex items-center gap-1 overflow-x-auto">
            {site.pages.map((p) => (
              <Link
                key={p.id}
                href={sitePath(site.slug, p.id)}
                aria-current={p.id === page.id ? "page" : undefined}
                className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground"
              >
                {p.name}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-12 px-5 py-10">
        {page.type === "form" && page.form ? (
          <section className="mx-auto w-full max-w-[640px]">
            <h1 className="mb-5 text-[28px] font-semibold tracking-tight">{page.name}</h1>
            <PublicFormView form={page.form} slug={site.slug} preview={preview} />
          </section>
        ) : null}
        <PublicBlocks blocks={page.blocks} slug={site.slug} preview={preview} />
      </main>
      <footer className="border-t py-6 text-center text-[12px] text-muted-foreground">
        {site.name} · Powered by{" "}
        <a href="/" className="text-foreground hover:underline">
          EveryOps
        </a>
      </footer>
    </div>
  );
}
