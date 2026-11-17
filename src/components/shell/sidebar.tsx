"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/ui/logo";
import { cn } from "@/lib/utils";
import { isActive, isAvailable, NAV_ITEMS } from "./nav";

const STORAGE_KEY = "mw.sidebar.collapsed";

/** Lit le chemin courant : à placer sous <Suspense> (routes à paramètre dynamique). */
/** Server-rendered counters next to an entry (e.g. budget alerts), keyed by href. */
export type NavBadges = Partial<Record<string, ReactNode>>;

export function Sidebar({ footer, badges }: { footer?: ReactNode; badges?: NavBadges }) {
  return <SidebarView pathname={usePathname()} footer={footer} badges={badges} />;
}

/** Barre latérale ; `pathname` null = repli sans élément actif (fallback de Suspense). */
export function SidebarView({
  pathname,
  footer,
  badges,
}: {
  pathname: string | null;
  footer?: ReactNode;
  badges?: NavBadges;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture d'une préférence locale après hydratation
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* stockage indisponible : on garde la barre ouverte */
    }
  }, []);

  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(STORAGE_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  }

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-bg md:flex",
        "w-60 transition-[width] duration-[var(--duration-slow)] ease-out data-[collapsed=true]:w-14",
      )}
    >
      <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-3">
        <Link
          href="/"
          className={cn(
            "flex items-center gap-2 rounded-sm px-1 text-base font-semibold",
            collapsed && "sr-only",
          )}
        >
          <LogoMark />
          myWallet
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Déplier la barre latérale" : "Replier la barre latérale"}
          aria-expanded={!collapsed}
          className="flex size-8 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-text"
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>

      <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto p-2">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = pathname !== null && isActive(pathname, item.href);
            const available = isAvailable(item);
            const content = (
              <>
                <item.icon className="size-4" aria-hidden />
                <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>
                {!available && !collapsed && (
                  <span className="ml-auto text-xs text-subtle">S{item.sprint}</span>
                )}
                {available && !collapsed && badges?.[item.href]}
              </>
            );
            const base = cn(
              "flex h-8 items-center gap-2.5 rounded-sm px-2 text-base",
              collapsed && "justify-center px-0",
            );
            return (
              <li key={item.href}>
                {available ? (
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      base,
                      "text-muted transition-colors duration-[var(--duration-fast)] hover:bg-surface-2 hover:text-text",
                      active && "bg-surface-2 text-text",
                    )}
                  >
                    {content}
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    title={`Disponible au sprint ${item.sprint}`}
                    className={cn(base, "cursor-not-allowed text-subtle")}
                  >
                    {content}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {footer && (
        <div className={cn("border-t border-border p-2", collapsed && "hidden")}>{footer}</div>
      )}
    </aside>
  );
}
