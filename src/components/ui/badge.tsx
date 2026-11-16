import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border-strong bg-surface-2 text-muted",
        accent: "border-transparent bg-accent-subtle text-accent",
        warning: "border-warning/30 text-warning",
        danger: "border-danger/30 text-danger",
        muted: "border-border text-muted",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export type ClaimStatus = "pending" | "reimbursed" | "gifted";

const claimLabels: Record<ClaimStatus, string> = {
  pending: "À rembourser",
  reimbursed: "Remboursé",
  gifted: "Offert",
};

const claimTones = {
  pending: "warning",
  reimbursed: "accent",
  gifted: "muted",
} as const satisfies Record<ClaimStatus, BadgeProps["tone"]>;

/** Statuts de créance : en attente = warning, remboursé = accent, offert = muted. */
export function ClaimBadge({ status, className }: { status: ClaimStatus; className?: string }) {
  return (
    <Badge tone={claimTones[status]} className={className}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {claimLabels[status]}
    </Badge>
  );
}
