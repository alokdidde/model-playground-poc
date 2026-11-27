"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/compare", label: "Compare" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/ops/rate-limits", label: "Rate limits" },
];

export function SiteNav() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname.startsWith(href);
  return (
    <header className="bg-background border-b">
      <nav className="mx-auto flex max-w-[1600px] items-center gap-2 px-4 py-2.5 sm:gap-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold">
          <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
            <Layers className="size-4" />
          </span>
          <span className="hidden sm:inline">Model FOMO</span>
        </Link>
        <div className="-mr-4 flex min-w-0 items-center gap-1 overflow-x-auto pr-4 sm:mr-0 sm:pr-0 [scrollbar-width:none]">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors sm:px-3",
                isActive(item.href) ? "bg-accent-soft text-accent-soft-foreground font-medium" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <span className="text-muted-foreground ml-auto hidden text-xs lg:block">Powered by DigitalOcean serverless inference</span>
      </nav>
    </header>
  );
}
