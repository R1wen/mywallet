"use client";

import { LogOut } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { merchantInitials } from "@/lib/domain/merchant";
import { useSignOut } from "./sign-out";

/** Menu utilisateur de la barre supérieure mobile (la barre latérale est masquée). */
export function MobileUserMenu({ name, email }: { name: string; email: string }) {
  const signOut = useSignOut();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Compte de ${name}`}
        className="flex size-11 items-center justify-center rounded-sm md:hidden"
      >
        <span className="flex size-8 items-center justify-center rounded-sm border border-border bg-surface-2 text-xs font-medium text-muted">
          {merchantInitials(name)}
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-56 rounded-md border border-border-strong bg-surface-2 p-1 data-[state=open]:animate-fade-in"
        >
          <div className="flex flex-col px-2 py-2">
            <span className="truncate text-sm font-medium">{name}</span>
            <span className="truncate text-xs text-muted">{email}</span>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={() => void signOut()}
            className="flex h-11 cursor-default items-center gap-2 rounded-sm px-2 text-base text-muted outline-none select-none data-[highlighted]:bg-surface data-[highlighted]:text-text"
          >
            <LogOut className="size-4" aria-hidden />
            Se déconnecter
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
