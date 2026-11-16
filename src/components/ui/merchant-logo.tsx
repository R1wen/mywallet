import { cn } from "@/lib/utils";
import { merchantInitials } from "@/lib/domain/merchant";

type MerchantLogoProps = {
  name: string;
  /** URL servie par notre propre route (cache serveur), jamais un fournisseur tiers en direct. */
  src?: string | null;
  size?: 28 | 32 | 36;
  className?: string;
};

const sizes = { 28: "size-7 text-xs", 32: "size-8 text-xs", 36: "size-9 text-sm" } as const;

/** Pastille carrée à coins arrondis ; repli en monogramme sur --surface-2. */
export function MerchantLogo({ name, src, size = 32, className }: MerchantLogoProps) {
  const box = cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border",
    sizes[size],
    className,
  );
  if (src) {
    return (
      <span className={cn(box, "bg-surface-2")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- logo servi depuis notre cache, déjà dimensionné */}
        <img src={src} alt="" width={size} height={size} className="size-full object-contain p-1" />
        <span className="sr-only">{name}</span>
      </span>
    );
  }
  return (
    <span className={cn(box, "bg-surface-2 font-medium text-muted")} aria-label={name} role="img">
      {merchantInitials(name)}
    </span>
  );
}
