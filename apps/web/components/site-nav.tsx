import Link from "next/link";
import { Layers } from "lucide-react";

/** One page to start from: the logo goes home, which is Compare. Past runs open from the Compare page. */
export function SiteNav() {
  return (
    <header className="bg-background border-b">
      <nav className="mx-auto flex max-w-[1600px] items-center gap-2 px-4 py-2.5">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold">
          <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
            <Layers className="size-4" />
          </span>
          <span>Model FOMO</span>
        </Link>
      </nav>
    </header>
  );
}
