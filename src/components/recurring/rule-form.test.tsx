import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecurringFormData } from "@/lib/actions/recurring";
import { RuleForm } from "./rule-form";

const saveRule = vi.fn();
const removeRule = vi.fn();
vi.mock("@/lib/actions/recurring", () => ({
  saveRule: (...args: unknown[]) => saveRule(...args),
  removeRule: (...args: unknown[]) => removeRule(...args),
}));
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));

const LIVRET = "0b7c5f0e-5b8e-4c1a-9a57-6b1f0b3e2a11";
const COURANT = "6f1d2c3b-4a5e-4f60-8a71-92b3c4d5e6f7";
const RULE = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";

const data: RecurringFormData = {
  // Le compte courant n'est pas le premier : il doit quand même être proposé par défaut.
  accounts: [
    { id: LIVRET, name: "Livret A", type: "savings" },
    { id: COURANT, name: "Compte courant", type: "checking" },
  ],
  categories: [],
  merchants: ["EDF", "Netflix"],
};

beforeEach(() => {
  saveRule.mockReset();
  removeRule.mockReset();
});

describe("RuleForm", () => {
  it("creates a monthly charge on the checking account and previews the schedule", async () => {
    saveRule.mockResolvedValue({ ok: true, data: { id: RULE } });
    const onDone = vi.fn();
    render(<RuleForm data={data} rule={null} onDone={onDone} />);
    const user = userEvent.setup();

    expect(screen.getByLabelText("Montant")).toHaveFocus();
    await user.type(screen.getByLabelText("Montant"), "78,40");
    await user.type(screen.getByLabelText("Magasin ou organisme"), "EDF");
    await user.selectOptions(screen.getByLabelText("Le jour"), "8");
    expect(screen.getByText(/^Tous les mois, le 8/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(saveRule).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        kind: "expense",
        amount: "78,40",
        merchantName: "EDF",
        accountId: COURANT,
        frequency: "monthly",
        dayOfMonth: "8",
      }),
    );
  });

  it("asks for the savings account of a saving and shows server errors", async () => {
    saveRule.mockResolvedValue({ ok: false, error: "Compte introuvable." });
    render(<RuleForm data={data} rule={null} onDone={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: "Épargne" }));
    expect(screen.queryByLabelText("Magasin ou organisme")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Montant"), "200");
    await user.type(screen.getByLabelText("Libellé"), "Épargne");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(await screen.findByText("Choisissez le compte d'épargne.")).toBeInTheDocument();
    expect(saveRule).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("Compte d'épargne"), LIVRET);
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Compte introuvable.");
  });

  it("hides the day for a weekly rule and locks the saving kind when editing a charge", async () => {
    render(
      <RuleForm
        data={data}
        rule={{
          id: RULE,
          kind: "expense",
          label: "Netflix",
          amountCents: 1499,
          merchantName: "Netflix",
          accountId: COURANT,
          toAccountId: null,
          categoryId: null,
          frequency: "monthly",
          interval: 1,
          dayOfMonth: 15,
          startOn: "2026-01-15",
          endOn: null,
        }}
        onDone={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    expect(screen.getByLabelText("Montant")).toHaveValue("14,99");
    expect(screen.getByRole("radio", { name: "Épargne" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Fréquence"), "weekly");
    expect(screen.queryByLabelText("Le jour")).not.toBeInTheDocument();
    expect(screen.getByText(/^Toutes les semaines, le jeudi/)).toBeInTheDocument();
  });
});
