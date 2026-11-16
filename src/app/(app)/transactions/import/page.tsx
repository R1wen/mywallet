import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { BankImport } from "@/components/imports/bank-import";
import { PageHeader } from "@/components/shell/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { listAccounts } from "@/lib/server/accounts";

export default function BankImportPage() {
  return (
    <>
      <Link
        href="/transactions"
        className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-text md:min-h-0"
      >
        <ChevronLeft className="size-4" aria-hidden /> Transactions
      </Link>
      <PageHeader
        title="Importer un relevé bancaire"
        description="Aperçu complet avant import : rien n'est enregistré sans votre confirmation."
      />
      <Suspense fallback={<Skeleton className="h-40" />}>
        <Loaded />
      </Suspense>
    </>
  );
}

async function Loaded() {
  const user = await requireUser();
  const accounts = await listAccounts(user.id);
  return <BankImport accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} />;
}
