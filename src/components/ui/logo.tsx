import { cn } from "@/lib/utils";

/** Marque myWallet : pastille neutre (l'accent est réservé aux entrées, actions et focus). */
export function LogoMark({ size = 20, className }: { size?: 20 | 24; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[5px] border border-border-strong bg-surface-2",
        size === 24 ? "size-6" : "size-5",
        className,
      )}
    >
      <span
        className={cn(
          "rounded-[1px] border-[1.5px] border-text",
          size === 24 ? "h-2.5 w-3" : "h-2 w-2.5",
        )}
      />
    </span>
  );
}
