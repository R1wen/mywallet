import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ReceiptStatus } from "@/lib/db/schema";
import type { ConfidenceLevel } from "@/lib/domain/receipts/validate";
import { cn } from "@/lib/utils";

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  uploaded: "Envoyé",
  processing: "En traitement",
  to_review: "À vérifier",
  manual: "À saisir",
  validated: "Validé",
  rejected: "Rejeté",
};

const TONES: Record<ReceiptStatus, "neutral" | "warning" | "muted"> = {
  uploaded: "neutral",
  processing: "neutral",
  to_review: "warning",
  manual: "warning",
  validated: "muted",
  rejected: "muted",
};

export function ReceiptStatusBadge({ status }: { status: ReceiptStatus }) {
  return <Badge tone={TONES[status]}>{RECEIPT_STATUS_LABELS[status]}</Badge>;
}

const LEVEL_LABELS: Record<ConfidenceLevel, string> = {
  high: "Lecture fiable",
  medium: "À relire",
  low: "Lecture incertaine",
};

/** Sober confidence hint: text only, warning tone when the reading is uncertain. */
export function ConfidenceHint({
  level,
  className,
}: {
  level: ConfidenceLevel;
  className?: string;
}) {
  return (
    <span className={cn("text-xs", level === "low" ? "text-warning" : "text-muted", className)}>
      {LEVEL_LABELS[level]}
    </span>
  );
}

/** 36 px thumbnail tile, document icon when there is no image. */
export function ReceiptThumb({
  id,
  hasThumbnail,
  className,
}: {
  id: string;
  hasThumbnail: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-surface-2 text-muted",
        className,
      )}
    >
      {hasThumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, per-user file
        <img
          src={`/api/receipts/${id}/thumbnail`}
          alt=""
          className="size-full object-cover"
          loading="lazy"
        />
      ) : (
        <FileText className="size-4" aria-hidden />
      )}
    </span>
  );
}
