"use client";

import { Plus } from "lucide-react";
import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { loadRuleDialog, type RecurringFormData, type RuleDetail } from "@/lib/actions/recurring";
import { RuleForm } from "./rule-form";

type Ctx = { openNew: () => void; openEdit: (id: string) => void };
const RuleDialogContext = createContext<Ctx | null>(null);

export function useRuleDialog(): Ctx {
  const ctx = use(RuleDialogContext);
  if (!ctx) throw new Error("useRuleDialog must be used inside RuleDialogProvider");
  return ctx;
}

type State =
  | { status: "closed" }
  | { status: "loading"; editId: string | null }
  | { status: "ready"; data: RecurringFormData; rule: RuleDetail | null }
  | { status: "error"; message: string };

/** "New / edit recurring rule" dialog of the Récurrent screen. */
export function RuleDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "closed" });
  // Une réponse tardive (fenêtre fermée ou autre règle ouverte entre-temps) est ignorée.
  const request = useRef(0);

  const open = useCallback(async (editId: string | null) => {
    const current = ++request.current;
    setState({ status: "loading", editId });
    try {
      const { data, rule } = await loadRuleDialog(editId);
      if (current !== request.current) return;
      if (editId && !rule) {
        setState({ status: "error", message: "Cette règle n'existe plus." });
      } else if (data.accounts.length === 0) {
        setState({ status: "error", message: "Créez d'abord un compte dans les réglages." });
      } else {
        setState({ status: "ready", data, rule });
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
  const close = () => {
    request.current++;
    setState({ status: "closed" });
  };
  const isEdit =
    (state.status === "loading" && state.editId !== null) ||
    (state.status === "ready" && state.rule !== null);

  return (
    <RuleDialogContext value={value}>
      {children}
      <Dialog open={state.status !== "closed"} onOpenChange={(o) => !o && close()}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Modifier la règle" : "Nouvelle règle récurrente"}</DialogTitle>
          </DialogHeader>
          {state.status === "loading" && (
            <div className="flex flex-col gap-4 px-5 pb-5" aria-busy="true">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}
          {state.status === "error" && (
            <p role="alert" className="px-5 pb-5 text-sm text-danger">
              {state.message}
            </p>
          )}
          {state.status === "ready" && (
            <RuleForm
              key={state.rule?.id ?? "new"}
              data={state.data}
              rule={state.rule}
              onDone={close}
            />
          )}
        </DialogContent>
      </Dialog>
    </RuleDialogContext>
  );
}

export function NewRuleButton({ label = "Nouvelle règle" }: { label?: string }) {
  const { openNew } = useRuleDialog();
  return (
    <Button variant="primary" size="sm" onClick={openNew}>
      <Plus aria-hidden /> {label}
    </Button>
  );
}

/** Row button opening a rule for editing. */
export function RuleButton({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const { openEdit } = useRuleDialog();
  return (
    <button type="button" className={className} onClick={() => openEdit(id)}>
      {children}
    </button>
  );
}
