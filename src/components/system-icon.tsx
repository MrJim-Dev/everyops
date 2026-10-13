import {
  AirplaneTiltIcon,
  BriefcaseIcon,
  CalendarBlankIcon,
  ChartBarIcon,
  GaugeIcon,
  GridFourIcon,
  HouseIcon,
  type Icon,
  ImageIcon,
  KeyIcon,
  MegaphoneSimpleIcon,
  PackageIcon,
  ReceiptIcon,
  StorefrontIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import type { IconName } from "@/lib/blueprint/types";

const ICONS: Record<IconName, Icon> = {
  calendar: CalendarBlankIcon,
  court: GridFourIcon,
  users: UsersIcon,
  user: UserIcon,
  receipt: ReceiptIcon,
  storefront: StorefrontIcon,
  package: PackageIcon,
  chart: ChartBarIcon,
  wallet: WalletIcon,
  megaphone: MegaphoneSimpleIcon,
  image: ImageIcon,
  briefcase: BriefcaseIcon,
  airplane: AirplaneTiltIcon,
  house: HouseIcon,
  key: KeyIcon,
  gauge: GaugeIcon,
};

export function SystemIcon({ name, className }: { name: IconName; className?: string }) {
  const Glyph = ICONS[name] ?? GridFourIcon;
  return <Glyph className={className} />;
}
