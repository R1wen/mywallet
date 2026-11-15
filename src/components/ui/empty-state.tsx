import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: LucideIcon;
  /** Une phrase utile, pas de slogan. */
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="flex size-9 items-center justify-center rounded-md border border-border bg-surface-2 text-muted">
          <Icon className="size-4" aria-hidden />
        </span>
      )}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-base font-medium text-text">{title}</p>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
