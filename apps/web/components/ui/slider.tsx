"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

/** `aria-label` and `valueText` go on the thumb, which is the element screen readers focus. */
function Slider({
  className,
  "aria-label": ariaLabel,
  valueText,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & { valueText?: string }) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50", className)}
      {...props}
    >
      <SliderPrimitive.Track className="bg-muted relative h-1.5 w-full grow overflow-hidden rounded-full">
        <SliderPrimitive.Range className="bg-primary absolute h-full" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={ariaLabel}
        aria-valuetext={valueText}
        className="border-primary bg-background ring-ring/50 block size-4 shrink-0 rounded-full border shadow-sm transition-shadow hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden" />
    </SliderPrimitive.Root>
  );
}

export { Slider };
