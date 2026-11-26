import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Model FOMO",
  description: "Send one prompt to many models on DigitalOcean and see which answer is best.",
};

const NAV = [
  { href: "/", label: "Compare" },
  { href: "/evals", label: "Batch evals" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b">
          <nav className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-semibold">
              Model FOMO
            </Link>
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="text-muted-foreground hover:text-foreground text-sm">
                {item.label}
              </Link>
            ))}
            <span className="text-muted-foreground ml-auto hidden text-xs sm:block">Powered by DigitalOcean serverless inference</span>
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
