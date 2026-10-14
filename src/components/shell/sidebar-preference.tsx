import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { SidebarPreferenceProvider } from "@/lib/store/sidebar";
import { SIDEBAR_COOKIE } from "@/lib/store/sidebar-cookie";

/** Reads the saved sidebar state on the server. It reads cookies, so it must sit inside <Suspense>. */
export async function SidebarPreference({ children }: { children: ReactNode }) {
  const value = (await cookies()).get(SIDEBAR_COOKIE)?.value;
  const collapsed = value === "collapsed" ? true : value === "expanded" ? false : null;
  return <SidebarPreferenceProvider collapsed={collapsed}>{children}</SidebarPreferenceProvider>;
}
