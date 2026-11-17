import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { MobileUserMenu } from "@/components/shell/mobile-user-menu";
import { UserMenu } from "@/components/shell/user-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { toParisDateString } from "@/lib/domain/dates";
import { budgetAlerts } from "@/lib/server/budgets";

/**
 * La coquille est statique (prérendue). La session est lue sous <Suspense> :
 * le contenu n'est rendu qu'après validation serveur de la session.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell
      userMenu={
        <Suspense fallback={<Skeleton className="h-9 w-full" />}>
          <CurrentUserMenu />
        </Suspense>
      }
      navBadges={{
        "/budgets": (
          <Suspense fallback={null}>
            <BudgetAlertBadge />
          </Suspense>
        ),
      }}
      topbarActions={
        <Suspense fallback={<Skeleton className="size-8 md:hidden" />}>
          <CurrentMobileUserMenu />
        </Suspense>
      }
    >
      <Suspense fallback={<ContentSkeleton />}>
        <AuthGate>{children}</AuthGate>
      </Suspense>
    </AppShell>
  );
}

async function AuthGate({ children }: { children: ReactNode }) {
  await requireUser();
  return children;
}

async function CurrentUserMenu() {
  const user = await requireUser();
  return <UserMenu name={user.name} email={user.email} />;
}

async function CurrentMobileUserMenu() {
  const user = await requireUser();
  return <MobileUserMenu name={user.name} email={user.email} />;
}

/** Number of budgets at or past their alert threshold this month (ADR-037). */
async function BudgetAlertBadge() {
  const user = await requireUser();
  const alerts = await budgetAlerts(user.id, toParisDateString(new Date()));
  if (!alerts.length) return null;
  return (
    <span className="ml-auto rounded-sm border border-warning/40 px-1.5 text-xs text-warning tabular-nums">
      {alerts.length}
      <span className="sr-only"> alerte{alerts.length > 1 ? "s" : ""} de budget</span>
    </span>
  );
}

function ContentSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
