import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { StoreHydration } from "@/components/store-hydration";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  applicationName: "EveryOps",
  title: { default: "EveryOps", template: "%s · EveryOps" },
  description: "Describe your business and EveryOps builds the systems you need inside one workspace.",
  openGraph: { siteName: "EveryOps", type: "website" },
};

export const viewport: Viewport = { themeColor: "#000000" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <TooltipProvider delay={400}>{children}</TooltipProvider>
        <Toaster position="bottom-left" />
        <StoreHydration />
      </body>
    </html>
  );
}
