import { SiteNav } from "@/components/shell/site-nav";

export default function HubLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-dvh overflow-x-clip bg-shell">
      <SiteNav variant="app" />
      <main className="mx-auto flex max-w-[1200px] flex-col px-5 pb-20">{children}</main>
    </div>
  );
}
