import type { Metadata, Viewport } from "next";
import { SiteNav } from "@/components/site-nav";
import "./globals.css";

export const viewport: Viewport = {
  // Matches the page token in each mode, so the mobile browser bar blends in.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export const metadata: Metadata = {
  title: "Model FOMO",
  description: "Send one prompt to many models and see which answer is best.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <SiteNav />
        <main className="mx-auto max-w-[1600px] px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
