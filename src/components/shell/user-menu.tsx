"use client";

import { LogOut } from "lucide-react";
import { merchantInitials } from "@/lib/domain/merchant";
import { useSignOut } from "./sign-out";

export function UserMenu({ name, email }: { name: string; email: string }) {
  const signOut = useSignOut();
  return (
    <div className="flex items-center gap-2.5 px-1">
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 text-xs font-medium text-muted"
      >
        {merchantInitials(name)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="truncate text-xs text-muted">{email}</span>
      </span>
      <button
        type="button"
        onClick={signOut}
        aria-label="Se déconnecter"
        title="Se déconnecter"
        className="flex size-8 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-text pointer-coarse:size-11"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}
