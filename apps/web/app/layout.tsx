import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Model FOMO",
  description: "Send one prompt to many models on DigitalOcean and see which answer is best.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-muted/40 min-h-screen antialiased">
        <SiteNav />
        <main className="mx-auto max-w-[1600px] px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
