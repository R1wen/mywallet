import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Placeholder statique (pas de shimmer) : un aplat discret. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      data-slot="skeleton"
      className={cn("animate-pulse rounded-sm bg-surface-2 motion-reduce:animate-none", className)}
      {...props}
    />
  );
}
