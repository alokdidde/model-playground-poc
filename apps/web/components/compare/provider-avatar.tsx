import { cn } from "@/lib/utils";

/** A letter avatar with a stable colour per provider (we ship no vendor logos). */
export function ProviderAvatar({ provider, className }: { provider: string; className?: string }) {
  let hash = 0;
  for (const ch of provider) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white", className)}
      style={{ backgroundColor: `oklch(0.62 0.15 ${hash})` }}
    >
      {provider[0]?.toUpperCase()}
    </span>
  );
}
