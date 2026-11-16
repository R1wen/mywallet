"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("flex h-9 items-end gap-4 border-b border-border", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "-mb-px flex h-9 items-center border-b border-transparent text-base font-medium text-muted",
        "transition-colors duration-[var(--duration-fast)] hover:text-text",
        "data-[state=active]:border-accent data-[state=active]:text-text",
        "pointer-coarse:min-h-11",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("pt-4 outline-none data-[state=active]:animate-fade-in", className)}
      {...props}
    />
  );
}
