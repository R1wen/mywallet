"use client";

import { PenLine, Plus, ReceiptText } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { useTransactionDialog } from "@/components/transactions/transaction-dialog";
import { cn } from "@/lib/utils";
import { isActive, isAvailable, NAV_ITEMS } from "./nav";

/** Lit le chemin courant : à placer sous <Suspense> (routes à paramètre dynamique). */
export function MobileTabbar() {
  return <MobileTabbarView pathname={usePathname()} />;
}

/** `pathname` null = repli sans onglet actif (fallback de Suspense). */
export function MobileTabbarView({ pathname }: { pathname: string | null }) {
  const { openNew } = useTransactionDialog();
  const router = useRouter();
  const tabs = NAV_ITEMS.filter((i) => i.mobile);
  const left = tabs.slice(0, 2);
  const right = tabs.slice(2, 4);

  const renderTab = (item: (typeof tabs)[number]) => {
    const available = isAvailable(item);
    const active = pathname !== null && isActive(pathname, item.href);
    const cls = cn(
      "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs",
      active ? "text-text" : "text-muted",
      !available && "text-subtle",
    );
    const inner = (
      <>
        <item.icon className="size-5" aria-hidden />
        <span>{item.label === "Tableau de bord" ? "Accueil" : item.label}</span>
      </>
    );
    return available ? (
      <Link
        key={item.href}
        href={item.href}
        className={cls}
        aria-current={active ? "page" : undefined}
      >
        {inner}
      </Link>
    ) : (
      <span key={item.href} className={cls} aria-disabled="true">
        {inner}
      </span>
    );
  };

  return (
    <nav
      aria-label="Navigation mobile"
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-border bg-bg pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
    >
      {left.map(renderTab)}
      <div className="flex flex-1 items-center justify-center">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            aria-label="Ajouter un ticket ou une transaction"
            className="flex size-11 items-center justify-center rounded-md bg-accent text-bg active:bg-accent/80"
          >
            <Plus className="size-5" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top"
              sideOffset={8}
              className="z-50 min-w-56 rounded-md border border-border-strong bg-surface-2 p-1 data-[state=open]:animate-fade-in"
            >
              <DropdownMenu.Item
                onSelect={() => router.push("/tickets")}
                className="flex h-11 cursor-default items-center gap-2 rounded-sm px-2 text-base text-text outline-none select-none data-[highlighted]:bg-surface"
              >
                <ReceiptText className="size-4 text-muted" aria-hidden />
                Ajouter un ticket
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={openNew}
                className="flex h-11 cursor-default items-center gap-2 rounded-sm px-2 text-base text-text outline-none select-none data-[highlighted]:bg-surface"
              >
                <PenLine className="size-4 text-muted" aria-hidden />
                Saisir une transaction
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {right.map(renderTab)}
    </nav>
  );
}
