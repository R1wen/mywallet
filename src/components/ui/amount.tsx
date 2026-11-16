import { formatCents, type Cents } from "@/lib/domain/money";
import { cn } from "@/lib/utils";

type AmountProps = {
  cents: Cents;
  currency?: string;
  /**
   * `flow`: entrée d'argent en accent avec "+", dépense neutre avec "-".
   * `plain`: montant neutre (soldes, totaux).
   */
  variant?: "flow" | "plain";
  className?: string;
};

export function Amount({ cents, currency = "EUR", variant = "plain", className }: AmountProps) {
  const isIncome = variant === "flow" && cents > 0;
  const text = formatCents(cents, { currency, sign: variant === "flow" ? "always" : "auto" });
  return (
    <span
      data-amount
      className={cn("whitespace-nowrap", isIncome ? "text-accent" : "text-text", className)}
    >
      {text}
    </span>
  );
}
