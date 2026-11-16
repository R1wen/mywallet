import { FileSpreadsheet, ReceiptText } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { ReceiptList } from "@/components/receipts/receipt-list";
import { UploadPanel } from "@/components/receipts/upload-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { listReceipts } from "@/lib/server/receipts";

export default function TicketsPage() {
  return (
    <>
      <PageHeader
        title="Tickets"
        description="Photos et factures lues dans votre navigateur, enregistrées après votre vérification."
        actions={
          <Button asChild variant="outline">
            <Link href="/transactions/import">
              <FileSpreadsheet /> Importer un relevé
            </Link>
          </Button>
        }
      />
      <UploadPanel />
      <Suspense fallback={<QueueSkeleton />}>
        <Queue />
      </Suspense>
    </>
  );
}

async function Queue() {
  const user = await requireUser();
  const rows = await listReceipts(user.id);
  const toReview = rows.filter((r) => r.status === "to_review" || r.status === "manual");
  const pending = rows.filter((r) => r.status === "uploaded" || r.status === "processing");
  const done = rows.filter((r) => r.status === "validated" || r.status === "rejected").slice(0, 30);

  if (!rows.length) {
    return (
      <Card className="mt-6">
        <EmptyState
          icon={ReceiptText}
          title="Aucun ticket pour l'instant."
          description="Déposez une photo ou un PDF ci-dessus : rien n'est enregistré avant votre validation."
        />
      </Card>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      {[
        { title: "À vérifier", rows: toReview },
        { title: "En attente de lecture", rows: pending },
        { title: "Traités récemment", rows: done },
      ]
        .filter((s) => s.rows.length)
        .map((s) => (
          <Card key={s.title}>
            <CardHeader>
              <CardTitle>
                {s.title}{" "}
                <span className="font-normal text-muted tabular-nums">{s.rows.length}</span>
              </CardTitle>
            </CardHeader>
            <ReceiptList rows={s.rows} />
          </Card>
        ))}
    </div>
  );
}

function QueueSkeleton() {
  return (
    <Card className="mt-6 flex flex-col gap-3 p-4">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </Card>
  );
}
