import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionFormData } from "@/lib/actions/transactions";
import { TransactionForm } from "./transaction-form";

const saveTransaction = vi.fn();
const removeTransaction = vi.fn();
vi.mock("@/lib/actions/transactions", () => ({
  saveTransaction: (...args: unknown[]) => saveTransaction(...args),
  removeTransaction: (...args: unknown[]) => removeTransaction(...args),
}));
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/budgets/save-feedback", () => ({ showSaveFeedback: vi.fn() }));

const ACC = "0b7c5f0e-5b8e-4c1a-9a57-6b1f0b3e2a11";
const ACC2 = "6f1d2c3b-4a5e-4f60-8a71-92b3c4d5e6f7";
const COURSES = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
const SALAIRE = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const data: TransactionFormData = {
  accounts: [
    { id: ACC, name: "Compte courant" },
    { id: ACC2, name: "Livret A" },
  ],
  categories: [
    { id: COURSES, parentId: null, name: "Courses", kind: "expense" },
    { id: SALAIRE, parentId: null, name: "Salaire", kind: "income" },
  ],
  merchants: ["Carrefour", "Lidl"],
};

beforeEach(() => {
  saveTransaction.mockReset();
  removeTransaction.mockReset();
  window.localStorage.clear();
});

describe("TransactionForm", () => {
  it("submits amount + merchant with Enter, defaults to today and the first account", async () => {
    saveTransaction.mockResolvedValue({ ok: true, data: { id: "x" } });
    const onDone = vi.fn();
    render(<TransactionForm data={data} transaction={null} onDone={onDone} />);
    const user = userEvent.setup();

    expect(screen.getByLabelText("Montant")).toHaveFocus();
    await user.type(screen.getByLabelText("Montant"), "12,50");
    await user.type(screen.getByLabelText("Magasin ou site"), "Carrefour{Enter}");

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(saveTransaction).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        kind: "expense",
        amount: "12,50",
        merchantName: "Carrefour",
        accountId: ACC,
        occurredOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
    expect(window.localStorage.getItem("mw.lastAccountId")).toBe(ACC);
  });

  it("shows French validation errors without calling the server", async () => {
    render(<TransactionForm data={data} transaction={null} onDone={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Ajouter" }));
    expect(await screen.findByText("Saisissez un montant.")).toBeInTheDocument();
    expect(saveTransaction).not.toHaveBeenCalled();
  });

  it("shows the server error and stays open", async () => {
    saveTransaction.mockResolvedValue({ ok: false, error: "Compte introuvable." });
    const onDone = vi.fn();
    render(<TransactionForm data={data} transaction={null} onDone={onDone} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Montant"), "5{Enter}");
    await user.type(screen.getByLabelText("Libellé"), "Pain{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Compte introuvable.");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("filters categories by kind and asks for the credited account on a transfer", async () => {
    render(<TransactionForm data={data} transaction={null} onDone={vi.fn()} />);
    const user = userEvent.setup();
    expect(screen.getByRole("option", { name: "Courses" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Salaire" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Entrée" }));
    expect(screen.getByRole("option", { name: "Salaire" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Virement" }));
    expect(screen.queryByLabelText("Magasin ou site")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Compte crédité")).toBeInTheDocument();
  });

  it("asks for confirmation before deleting", async () => {
    removeTransaction.mockResolvedValue({ ok: true, data: undefined });
    const onDone = vi.fn();
    render(
      <TransactionForm
        data={data}
        transaction={{
          id: "t1",
          kind: "expense",
          amountCents: 123456,
          occurredOn: "2026-11-10",
          label: "Carrefour",
          notes: null,
          merchantName: "Carrefour",
          accountId: ACC,
          toAccountId: null,
          categoryId: COURSES,
        }}
        onDone={onDone}
      />,
    );
    const user = userEvent.setup();
    expect(screen.getByLabelText("Montant")).toHaveValue("1 234,56".replace(" ", " "));
    expect(screen.getByRole("radio", { name: "Virement" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    expect(removeTransaction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(removeTransaction).toHaveBeenCalledWith("t1");
  });
});
