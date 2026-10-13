import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { StoreHydration } from "@/components/store-hydration";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Hulma", template: "%s · Hulma" },
  description: "Describe your business and Hulma builds the systems you need inside one workspace.",
};

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
