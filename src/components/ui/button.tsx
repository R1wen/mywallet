import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-sm font-medium whitespace-nowrap select-none",
    "transition-colors duration-[var(--duration-fast)] ease-out",
    "disabled:pointer-events-none disabled:opacity-50",
    "pointer-coarse:min-h-11 [&_svg]:size-4",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent text-bg hover:bg-accent/90 active:bg-accent/80",
        secondary:
          "border border-border-strong bg-surface-2 text-text hover:border-muted/40 hover:bg-surface-2/70",
        ghost: "text-muted hover:bg-surface-2 hover:text-text",
        outline: "border border-border text-text hover:bg-surface-2",
        danger: "border border-danger/40 text-danger hover:bg-danger/10",
        link: "h-auto px-0 text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2.5 text-sm",
        md: "h-8 px-3 text-base",
        lg: "h-10 px-4 text-base",
        icon: "size-8 pointer-coarse:min-w-11",
        "icon-sm": "size-7 pointer-coarse:min-w-11",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
