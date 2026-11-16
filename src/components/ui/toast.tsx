"use client";

import { Toaster as Sonner, toast } from "sonner";

export { toast };

export function Toaster() {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      gap={8}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[356px] items-start gap-3 rounded-md border border-border-strong bg-surface-2 p-3 text-base text-text",
          title: "font-medium",
          description: "text-sm text-muted",
          actionButton: "ml-auto rounded-sm bg-accent px-2 py-1 text-sm font-medium text-bg",
          cancelButton: "rounded-sm px-2 py-1 text-sm text-muted",
          success: "[&_[data-icon]]:text-accent",
          error: "[&_[data-icon]]:text-danger",
          warning: "[&_[data-icon]]:text-warning",
        },
      }}
    />
  );
}
