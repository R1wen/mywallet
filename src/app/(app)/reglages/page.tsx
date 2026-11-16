import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { AccountsManager } from "@/components/settings/accounts-manager";
import { CategoriesManager } from "@/components/settings/categories-manager";
import { ImportSettings } from "@/components/settings/import-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { listAccountsWithBalance } from "@/lib/server/accounts";
import { listCategories } from "@/lib/server/categories";
import { getImportSettings } from "@/lib/server/import-settings";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Réglages"
        description="Vos comptes, vos catégories et la lecture des tickets."
      />
      <Suspense fallback={<SettingsSkeleton />}>
        <Settings />
      </Suspense>
    </>
  );
}

async function Settings() {
  const user = await requireUser();
  const [accounts, categories, importSettings] = await Promise.all([
    listAccountsWithBalance(user.id),
    listCategories(user.id),
    getImportSettings(user.id),
  ]);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="flex flex-col gap-4">
        <AccountsManager
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            institution: a.institution,
            openingBalanceCents: a.openingBalanceCents,
            balanceCents: a.balanceCents,
            movementCount: a.movementCount,
          }))}
        />
        <ImportSettings
          structurer={importSettings.structurer}
          available={importSettings.available}
        />
      </div>
      <CategoriesManager
        categories={categories.map((c) => ({
          id: c.id,
          parentId: c.parentId,
          name: c.name,
          kind: c.kind,
          position: c.position,
        }))}
      />
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-5" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-64 lg:col-span-2" />
      <Skeleton className="h-96 lg:col-span-3" />
    </div>
  );
}
