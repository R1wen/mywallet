import { PiggyBank } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MerchantLogo } from "@/components/ui/merchant-logo";
import { merchantLogoProps } from "@/components/ui/merchant-logo-props";
import type { OccurrenceStatus } from "@/lib/db/schema";
import type { MerchantLogoInfo } from "@/lib/server/merchants";

/** Logo of a rule or occurrence: piggy bank for savings, merchant logo, else monogram. */
export function RecurringLogo({
  kind,
  label,
  merchantId,
  merchantName,
  merchantLogo,
  size = 32,
}: {
  kind: "expense" | "income" | "transfer";
  label: string;
  merchantId: string | null;
  merchantName: string | null;
  merchantLogo: MerchantLogoInfo | null;
  size?: 28 | 32;
}) {
  if (kind === "transfer") {
    return (
      <span
        className={
          size === 28
            ? "inline-flex size-7 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 text-muted"
            : "inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 text-muted"
        }
      >
        <PiggyBank className="size-4" aria-hidden />
      </span>
    );
  }
  if (merchantId && merchantName && merchantLogo) {
    return (
      <MerchantLogo
        size={size}
        {...merchantLogoProps({ id: merchantId, name: merchantName, ...merchantLogo })}
      />
    );
  }
  return <MerchantLogo size={size} name={label} />;
}

/** Status of an occurrence; a planned one whose date has passed is "En retard". */
export function OccurrenceBadge({
  status,
  dueOn,
  today,
}: {
  status: OccurrenceStatus;
  dueOn: string;
  today: string;
}) {
  if (status === "confirmed") return <Badge tone="muted">Validée</Badge>;
  if (status === "skipped") return <Badge tone="muted">Ignorée</Badge>;
  if (dueOn < today) return <Badge tone="warning">En retard</Badge>;
  if (dueOn === today) return <Badge tone="warning">Aujourd&apos;hui</Badge>;
  return <Badge tone="neutral">Prévue</Badge>;
}
