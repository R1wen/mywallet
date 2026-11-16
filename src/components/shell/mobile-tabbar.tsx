"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { isActive, isAvailable, NAV_ITEMS } from "./nav";

export function MobileTabbar() {
  const pathname = usePathname();
  const tabs = NAV_ITEMS.filter((i) => i.mobile);
  const left = tabs.slice(0, 2);
  const right = tabs.slice(2, 4);

  const renderTab = (item: (typeof tabs)[number]) => {
    const available = isAvailable(item);
    const active = isActive(pathname, item.href);
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
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-border bg-bg pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {left.map(renderTab)}
      <div className="flex flex-1 items-center justify-center">
        <button
          type="button"
          aria-label="Ajouter un ticket"
          onClick={() => toast("L'import de tickets arrive au sprint 3.")}
          className="flex size-11 items-center justify-center rounded-md bg-accent text-bg active:bg-accent/80"
        >
          <Plus className="size-5" />
        </button>
      </div>
      {right.map(renderTab)}
    </nav>
  );
}
