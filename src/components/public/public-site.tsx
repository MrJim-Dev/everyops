"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { PublicPageData, PublicSite } from "@/lib/public/resolve";
import { sitePath } from "@/lib/public/resolve";
import { cn } from "@/lib/utils";
import { HtmlPageFrame } from "./html-page-frame";
import { PublicBlocks } from "./public-blocks";
import { PublicFormView } from "./public-form";

/** A workspace's public site in EveryOps's standard look: header with its pages, the page, and a footer. */
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
  const book = site.pages.find((p) => p.type === "form");
  const initial = site.name.trim().charAt(0).toUpperCase() || "E";
  return (
    <div className={cn("flex min-h-full flex-col bg-shell", !preview && "min-h-dvh")}>
      <header className="sticky top-0 z-20 border-b bg-shell/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center gap-4 px-5">
          <Link
            href={sitePath(site.slug)}
            className="flex min-w-0 items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em]"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-[13px] font-bold text-primary-foreground">
              {initial}
            </span>
            <span className="truncate">{site.name}</span>
          </Link>
          <nav aria-label="Pages" className="ml-auto hidden items-center gap-1 sm:flex">
            {site.pages
              .filter((p) => p.id !== book?.id)
              .map((p) => (
                <Link
                  key={p.id}
                  href={sitePath(site.slug, p.id)}
                  aria-current={p.id === page.id ? "page" : undefined}
                  className="whitespace-nowrap rounded-md px-3 py-1.5 text-[13.5px] text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground"
                >
                  {p.name}
                </Link>
              ))}
          </nav>
          {book ? (
            <Button
              size="sm"
              className="ml-auto h-8 rounded-full px-4 sm:ml-2"
              nativeButton={false}
              render={<Link href={sitePath(site.slug, book.id)} />}
            >
              {book.name}
            </Button>
          ) : null}
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-12 px-5 py-10 md:py-14">
        {page.type === "form" && page.form ? (
          <section className="mx-auto w-full max-w-[640px]">
            <h1 className="mb-6 text-[32px] font-semibold tracking-[-0.03em]">{page.name}</h1>
            <PublicFormView
              form={page.form}
              slug={site.slug}
              preview={preview}
              renderBlocks={(blocks) => (
                <PublicBlocks blocks={blocks} slug={site.slug} preview={preview} compact />
              )}
            />
          </section>
        ) : null}
        <PublicBlocks blocks={page.blocks} slug={site.slug} preview={preview} />
      </main>
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center gap-3 px-5 py-8 text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">{site.name}</span>
          <span className="ml-auto">
            Made with{" "}
            <a href="/" className="text-foreground underline-offset-4 hover:underline">
              EveryOps
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
