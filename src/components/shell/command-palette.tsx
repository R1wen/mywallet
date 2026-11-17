"use client";

import { Command } from "cmdk";
import {
  ArrowLeftRight,
  CornerDownLeft,
  Download,
  Eye,
  FileText,
  HandCoins,
  LogOut,
  PiggyBank,
  Plus,
  Search,
  Store,
  Tag,
  Users,
} from "lucide-react";
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
import { searchAction, type SearchResults } from "@/lib/actions/search";
import { formatDateFr } from "@/lib/domain/dates";
import { Amount } from "@/components/ui/amount";
import { isAvailable, NAV_ITEMS } from "./nav";
import { togglePrivateMode } from "./privacy-toggle";
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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);

  // Search my data as the user types (after a short pause); cmdk keeps filtering the rest.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const r = await searchAction(q).catch(() => null);
      if (!stale) setResults(r);
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

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
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Rechercher une page, une action, un magasin…"
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
                    value="à récupérer créances remboursement dette personnes amis"
                    onSelect={() => run(() => router.push("/personnes"))}
                  >
                    <HandCoins className="size-4" aria-hidden />
                    Voir ce que l&apos;on me doit
                  </Command.Item>
                  <Command.Item
                    className={itemClass}
                    value="budgets enveloppes objectifs épargne alerte"
                    onSelect={() => run(() => router.push("/budgets"))}
                  >
                    <PiggyBank className="size-4" aria-hidden />
                    Budgets et objectifs
                  </Command.Item>
                  <Command.Item
                    className={itemClass}
                    value="rapport du mois analyses tendances abonnements"
                    onSelect={() => run(() => router.push("/analyses/rapport"))}
                  >
                    <FileText className="size-4" aria-hidden />
                    Rapport du mois
                  </Command.Item>
                  <Command.Item
                    className={itemClass}
                    value="masquer afficher les montants mode privé"
                    onSelect={() => run(togglePrivateMode)}
                  >
                    <Eye className="size-4" aria-hidden />
                    Masquer ou afficher les montants
                    <Kbd className="ml-auto">H</Kbd>
                  </Command.Item>
                  <Command.Item
                    className={itemClass}
                    value="exporter transactions csv excel tableur"
                    onSelect={() =>
                      run(() => {
                        // A download, not a page: a plain link click keeps the current page.
                        const a = document.createElement("a");
                        a.href = "/api/export/transactions?format=xlsx";
                        a.click();
                      })
                    }
                  >
                    <Download className="size-4" aria-hidden />
                    Exporter les transactions (Excel)
                  </Command.Item>
                  <Command.Item
                    className={itemClass}
                    value="exporter toutes mes données rgpd supprimer compte"
                    onSelect={() => run(() => router.push("/reglages"))}
                  >
                    <Download className="size-4" aria-hidden />
                    Exporter mes données ou supprimer le compte
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
                {results && query.trim().length >= 2 && (
                  <>
                    {results.transactions.length > 0 && (
                      <Command.Group
                        heading="Mouvements"
                        className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-subtle"
                      >
                        {results.transactions.map((t) => (
                          <Command.Item
                            key={t.id}
                            value={`mouvement ${t.label} ${t.id} ${query}`}
                            className={itemClass}
                            onSelect={() => run(() => transactions.openEdit(t.id))}
                          >
                            <ArrowLeftRight className="size-4" aria-hidden />
                            <span className="truncate">{t.label}</span>
                            <span className="ml-auto flex items-center gap-3 text-xs">
                              {formatDateFr(t.occurredOn)}
                              <Amount cents={t.amountCents} variant="flow" className="text-sm" />
                            </span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                    {results.merchants.length > 0 && (
                      <Command.Group
                        heading="Magasins"
                        className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-subtle"
                      >
                        {results.merchants.map((m) => (
                          <Command.Item
                            key={m.id}
                            value={`magasin ${m.name} ${m.id} ${query}`}
                            className={itemClass}
                            onSelect={() => run(() => router.push(`/magasins/${m.id}`))}
                          >
                            <Store className="size-4" aria-hidden />
                            {m.name}
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                    {results.people.length > 0 && (
                      <Command.Group
                        heading="Personnes"
                        className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-subtle"
                      >
                        {results.people.map((p) => (
                          <Command.Item
                            key={p.id}
                            value={`personne ${p.name} ${p.id} ${query}`}
                            className={itemClass}
                            onSelect={() => run(() => router.push(`/personnes/${p.id}`))}
                          >
                            <Users className="size-4" aria-hidden />
                            {p.name}
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                    {results.categories.length > 0 && (
                      <Command.Group
                        heading="Catégories"
                        className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-subtle"
                      >
                        {results.categories.map((c) => (
                          <Command.Item
                            key={c.id}
                            value={`categorie ${c.name} ${c.id} ${query}`}
                            className={itemClass}
                            onSelect={() =>
                              run(() => router.push(`/transactions?categorie=${c.id}`))
                            }
                          >
                            <Tag className="size-4" aria-hidden />
                            Mouvements · {c.name}
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                  </>
                )}
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
