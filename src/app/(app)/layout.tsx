import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { UserMenu } from "@/components/shell/user-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";

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

function ContentSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
