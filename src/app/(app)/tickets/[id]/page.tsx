import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ReceiptActions } from "@/components/receipts/receipt-actions";
import { ReceiptReader } from "@/components/receipts/receipt-reader";
import { ReceiptViewer } from "@/components/receipts/receipt-viewer";
import { ConfidenceHint, ReceiptStatusBadge } from "@/components/receipts/receipt-visuals";
import { ReviewForm } from "@/components/receipts/review-form";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { formatDateFr, toParisDateString } from "@/lib/domain/dates";
import { listAccounts } from "@/lib/server/accounts";
import { listCategories } from "@/lib/server/categories";
import { listMerchantNames } from "@/lib/server/merchants";
import { getReceipt } from "@/lib/server/receipts";
import { idSchema } from "@/lib/validation/settings";

export default function TicketPage({ params }: PageProps<"/tickets/[id]">) {
  return (
    <>
      <Link
        href="/tickets"
        className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-text md:min-h-0"
      >
        <ChevronLeft className="size-4" aria-hidden /> Tickets
      </Link>
      <Suspense fallback={<TicketSkeleton />}>
        <Ticket params={params} />
      </Suspense>
    </>
  );
}

async function Ticket({ params }: Pick<PageProps<"/tickets/[id]">, "params">) {
  const user = await requireUser();
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const receipt = await getReceipt(user.id, id.data);
  if (!receipt) notFound();
  const today = toParisDateString(new Date());

  const title =
    receipt.extraction?.merchantName ??
    receipt.filename ??
    `Ticket du ${formatDateFr(receipt.createdAt)}`;
  const reviewable = receipt.status === "to_review" || receipt.status === "manual";
  const reading = receipt.status === "uploaded" || receipt.status === "processing";

  let body: React.ReactNode;
  if (reviewable) {
    const [accounts, categories, merchants] = await Promise.all([
      listAccounts(user.id),
      listCategories(user.id),
      listMerchantNames(user.id),
    ]);
    body = (
      <ReviewForm
        receipt={receipt}
        today={today}
        choices={{
          accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
          categories: categories
            .filter((c) => c.kind === "expense")
            .map((c) => ({
              id: c.id,
              parentId: c.parentId,
              name: c.name,
              kind: "expense" as const,
            })),
          merchants: merchants.map((m) => m.name),
        }}
      />
    );
  } else if (reading) {
    body = <ReceiptReader id={receipt.id} mimeType={receipt.mimeType} />;
  } else {
    body = <ReceiptActions receipt={receipt} />;
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
        <ReceiptStatusBadge status={receipt.status} />
        {receipt.extraction && receipt.status === "to_review" && (
          <ConfidenceHint level={receipt.extraction.level} />
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="h-[50vh] lg:sticky lg:top-20 lg:h-[calc(100vh-7rem)]">
          <ReceiptViewer id={receipt.id} mimeType={receipt.mimeType} />
        </div>
        <Card className="p-4 sm:p-5">{body}</Card>
      </div>
    </>
  );
}

function TicketSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <Skeleton className="h-[50vh]" />
      <Skeleton className="h-[50vh]" />
    </div>
  );
}
