"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Kbd } from "@/components/ui/kbd";
import { LogoMark } from "@/components/ui/logo";
import { useCommandPalette } from "./command-palette";

export function Topbar({ title, actions }: { title?: string; actions?: ReactNode }) {
  const palette = useCommandPalette();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-bg px-4 md:px-6">
      {/* Mobile : la barre latérale est masquée, la marque passe dans la barre supérieure. */}
      <Link href="/" className="flex items-center gap-2 text-base font-semibold md:hidden">
        <LogoMark />
        {title ?? "myWallet"}
      </Link>
      <button
        type="button"
        onClick={palette.open}
        className="ml-auto flex h-8 w-full max-w-80 items-center gap-2 rounded-sm border border-border-strong bg-surface px-2.5 text-left text-base text-muted transition-colors duration-[var(--duration-fast)] hover:border-muted/40 max-md:w-auto max-md:max-w-none max-md:border-transparent max-md:bg-transparent md:ml-0 pointer-coarse:min-h-11"
        aria-label="Rechercher (Ctrl+K)"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 max-md:sr-only">Rechercher…</span>
        <span className="flex gap-1 max-md:hidden" aria-hidden>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <div className="flex items-center gap-2 md:ml-auto">{actions}</div>
    </header>
  );
}
