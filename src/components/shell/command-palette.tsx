"use client";

import { Command } from "cmdk";
import { CornerDownLeft, LogOut, Plus, Search } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useRouter } from "next/navigation";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTransactionDialog } from "@/components/transactions/transaction-dialog";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { isAvailable, NAV_ITEMS } from "./nav";
import { useSignOut } from "./sign-out";

type PaletteContext = { open: () => void };
const Ctx = createContext<PaletteContext | null>(null);

export function useCommandPalette(): PaletteContext {
  const ctx = use(Ctx);
  if (!ctx) throw new Error("useCommandPalette must be used inside CommandPaletteProvider");
  return ctx;
}

const itemClass = cn(
  "flex h-9 cursor-default items-center gap-3 rounded-sm px-2 text-base text-muted outline-none select-none",
  "data-[selected=true]:bg-surface data-[selected=true]:text-text data-[disabled=true]:opacity-40",
  "pointer-coarse:h-11",
);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const router = useRouter();
  const signOut = useSignOut();
  const transactions = useTransactionDialog();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = useCallback((fn: () => void) => {
    setOpen(false);
    fn();
  }, []);

  const value = useMemo(() => ({ open: () => setOpen(true) }), []);

  return (
    <Ctx value={value}>
      {children}
      <DialogPrimitive.Root open={isOpen} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-fade-in" />
          <DialogPrimitive.Content
            className="fixed top-[14vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-md border border-border-strong bg-surface-2 data-[state=open]:animate-rise-in"
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">Palette de commandes</DialogPrimitive.Title>
            <Command loop label="Palette de commandes">
              <div className="flex h-12 items-center gap-3 border-b border-border px-4">
                <Search className="size-4 text-muted" aria-hidden />
                <Command.Input
                  autoFocus
                  placeholder="Rechercher une page ou une action…"
                  className="h-full flex-1 bg-transparent text-md text-text outline-none placeholder:text-muted"
                />
                <Kbd>Échap</Kbd>
              </div>
              <Command.List className="max-h-80 overflow-y-auto p-2">
                <Command.Empty className="px-2 py-6 text-center text-sm text-muted">
                  Aucun résultat.
                </Command.Empty>
                <Command.Group
                  heading="Actions"
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-subtle"
                >
                  <Command.Item
                    className={itemClass}
                    value="nouvelle transaction dépense entrée avoir virement"
                    onSelect={() => run(transactions.openNew)}
                  >
                    <Plus className="size-4" aria-hidden />
                    Nouvelle transaction
                    <Kbd className="ml-auto">N</Kbd>
                  </Command.Item>
                  <Command.Item
                    className={itemClass}
                    value="ajouter un ticket photo facture pdf"
                    onSelect={() => run(() => router.push("/tickets"))}
                  >
                    <Plus className="size-4" aria-hidden />
                    Ajouter un ticket
                  </Command.Item>
                  <Command.Item
                    className={itemClass}
                    value="importer un relevé bancaire csv"
                    onSelect={() => run(() => router.push("/transactions/import"))}
                  >
                    <Plus className="size-4" aria-hidden />
                    Importer un relevé bancaire
                  </Command.Item>
                  <Command.Item
                    className={itemClass}
                    value="se déconnecter"
                    onSelect={() => run(() => void signOut())}
                  >
                    <LogOut className="size-4" aria-hidden />
                    Se déconnecter
                  </Command.Item>
                </Command.Group>
                <Command.Group
                  heading="Aller à"
                  className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-subtle"
                >
                  {NAV_ITEMS.map((item) => {
                    const available = isAvailable(item);
                    return (
                      <Command.Item
                        key={item.href}
                        value={item.label}
                        disabled={!available}
                        className={itemClass}
                        onSelect={() => run(() => router.push(item.href))}
                      >
                        <item.icon className="size-4" aria-hidden />
                        {item.label}
                        {available ? (
                          <CornerDownLeft className="ml-auto size-3.5 text-subtle" aria-hidden />
                        ) : (
                          <span className="ml-auto text-xs text-subtle">Sprint {item.sprint}</span>
                        )}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              </Command.List>
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </Ctx>
  );
}
