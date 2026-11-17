import { Suspense, type ReactNode } from "react";
import { ShareDialogProvider } from "@/components/sharing/share-dialog";
import { TransactionDialogProvider } from "@/components/transactions/transaction-dialog";
import { CommandPaletteProvider } from "./command-palette";
import { MobileTabbar, MobileTabbarView } from "./mobile-tabbar";
import { Sidebar, SidebarView, type NavBadges } from "./sidebar";
import { Topbar } from "./topbar";

/**
 * Coquille statique : prérendue dans le shell. Tout ce qui lit la session
 * (menu utilisateur, données) arrive via des slots enveloppés de <Suspense>.
 */
export function AppShell({
  children,
  userMenu,
  topbarActions,
  navBadges,
}: {
  children: ReactNode;
  userMenu?: ReactNode;
  topbarActions?: ReactNode;
  navBadges?: NavBadges;
}) {
  return (
    <ShareDialogProvider>
      <TransactionDialogProvider>
        <CommandPaletteProvider>
          <a
            href="#contenu"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-surface-2 focus:px-3 focus:py-2"
          >
            Aller au contenu
          </a>
          <div className="flex min-h-dvh">
            {/* usePathname() exige un <Suspense> sur les routes dynamiques (/magasins/[id]). */}
            <Suspense
              fallback={<SidebarView pathname={null} footer={userMenu} badges={navBadges} />}
            >
              <Sidebar footer={userMenu} badges={navBadges} />
            </Suspense>
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar actions={topbarActions} />
              <main
                id="contenu"
                className="mx-auto w-full max-w-[1280px] flex-1 px-4 pt-6 pb-24 md:px-6 md:pb-10"
              >
                {children}
              </main>
            </div>
          </div>
          <Suspense fallback={<MobileTabbarView pathname={null} />}>
            <MobileTabbar />
          </Suspense>
        </CommandPaletteProvider>
      </TransactionDialogProvider>
    </ShareDialogProvider>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
        {description && <p className="text-base text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
