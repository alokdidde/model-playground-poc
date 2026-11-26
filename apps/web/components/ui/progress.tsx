import { cn } from "@/lib/utils";

function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("bg-primary/15 relative h-2 w-full overflow-hidden rounded-full", className)}>
      <div className="bg-primary h-full transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export { Progress };
