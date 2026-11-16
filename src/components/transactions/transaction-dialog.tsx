"use client";

import { Plus } from "lucide-react";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { loadTransactionDialog, type TransactionFormData } from "@/lib/actions/transactions";
import type { TransactionDetail } from "@/lib/server/transactions";
import { TransactionForm } from "./transaction-form";

type Ctx = { openNew: () => void; openEdit: (id: string) => void };
const TransactionDialogContext = createContext<Ctx | null>(null);

export function useTransactionDialog(): Ctx {
  const ctx = use(TransactionDialogContext);
  if (!ctx) throw new Error("useTransactionDialog must be used inside TransactionDialogProvider");
  return ctx;
}

type State =
  | { status: "closed" }
  | { status: "loading"; editId: string | null }
  | { status: "ready"; data: TransactionFormData; transaction: TransactionDetail | null }
  | { status: "error"; message: string };

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/**
 * Global "new / edit transaction" dialog. Opened from the command palette, the N key,
 * the topbar button, the mobile add button and any transaction row.
 */
export function TransactionDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "closed" });
  // Numéro de la dernière ouverture : une réponse tardive (fenêtre fermée entre-temps,
  // ou autre transaction ouverte depuis) est ignorée.
  const request = useRef(0);

  const open = useCallback(async (editId: string | null) => {
    const current = ++request.current;
    setState({ status: "loading", editId });
    try {
      const { data, transaction } = await loadTransactionDialog(editId);
      if (current !== request.current) return;
      if (editId && !transaction) {
        setState({ status: "error", message: "Cette transaction n'existe plus." });
      } else if (data.accounts.length === 0) {
        setState({ status: "error", message: "Créez d'abord un compte dans les réglages." });
      } else {
        setState({ status: "ready", data, transaction });
      }
    } catch {
      if (current === request.current) {
        setState({ status: "error", message: "Chargement impossible. Réessayez." });
      }
    }
  }, []);

  const value = useMemo<Ctx>(
    () => ({ openNew: () => void open(null), openEdit: (id) => void open(id) }),
    [open],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      void open(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => {
    request.current++;
    setState({ status: "closed" });
  };
  const isEdit =
    (state.status === "loading" && state.editId !== null) ||
    (state.status === "ready" && state.transaction !== null);

  return (
    <TransactionDialogContext value={value}>
      {children}
      <Dialog open={state.status !== "closed"} onOpenChange={(o) => !o && close()}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Modifier la transaction" : "Nouvelle transaction"}</DialogTitle>
          </DialogHeader>
          {state.status === "loading" && (
            <div className="flex flex-col gap-4 px-5 pb-5" aria-busy="true">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          )}
          {state.status === "error" && (
            <p role="alert" className="px-5 pb-5 text-sm text-danger">
              {state.message}
            </p>
          )}
          {state.status === "ready" && (
            <TransactionForm
              key={state.transaction?.id ?? "new"}
              data={state.data}
              transaction={state.transaction}
              onDone={close}
            />
          )}
        </DialogContent>
      </Dialog>
    </TransactionDialogContext>
  );
}

/** Primary "Nouvelle transaction" button. */
export function NewTransactionButton({ label = "Nouvelle transaction" }: { label?: string }) {
  const { openNew } = useTransactionDialog();
  return (
    <Button variant="primary" size="sm" onClick={openNew}>
      <Plus aria-hidden /> {label}
    </Button>
  );
}
