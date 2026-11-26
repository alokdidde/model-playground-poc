"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Compare" },
  { href: "/evals", label: "Batch evals" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function SiteNav() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <header className="bg-background border-b">
      <nav className="mx-auto flex max-w-[1600px] items-center gap-2 px-4 py-2.5 sm:gap-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
            <Layers className="size-4" />
          </span>
          <span className="hidden sm:inline">Model FOMO</span>
        </Link>
        <div className="flex items-center gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
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
