import { SettingsLayout } from "@/components/settings/settings-layout";

export default function Layout({ children }: LayoutProps<"/w/[workspace]/settings">) {
  return <SettingsLayout>{children}</SettingsLayout>;
}
