/**
 * Isolation au niveau de la couche d'accès aux données : l'utilisateur B ne peut
 * ni lire, ni modifier, ni archiver un compte de l'utilisateur A.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  archiveAccount,
  createAccount,
  getAccount,
  listAccounts,
  renameAccount,
} from "@/lib/server/accounts";
import { createUsers, deleteUsers } from "./helpers";

let A = "";
let B = "";
let accountOfA = "";

beforeAll(async () => {
  [A = "", B = ""] = await createUsers(2);
  const created = await createAccount(A, {
    name: "Compte courant de A",
    openingBalanceCents: 120000,
  });
  accountOfA = created.id;
  await createAccount(B, { name: "Compte de B" });
});

afterAll(async () => {
  await deleteUsers([A, B]);
});

describe("accounts — isolation A/B", () => {
  it("each user only lists their own accounts", async () => {
    expect((await listAccounts(A)).map((a) => a.name)).toEqual(["Compte courant de A"]);
    expect((await listAccounts(B)).map((a) => a.name)).toEqual(["Compte de B"]);
  });

  it("B cannot read A's account by id", async () => {
    expect(await getAccount(B, accountOfA)).toBeNull();
    expect((await getAccount(A, accountOfA))?.openingBalanceCents).toBe(120000);
  });

  it("B cannot rename A's account", async () => {
    expect(await renameAccount(B, accountOfA, "piraté")).toBe(false);
    expect((await getAccount(A, accountOfA))?.name).toBe("Compte courant de A");
  });

  it("B cannot archive A's account", async () => {
    expect(await archiveAccount(B, accountOfA)).toBe(false);
    expect((await listAccounts(A)).length).toBe(1);
  });

  it("A can rename and archive their own account", async () => {
    expect(await renameAccount(A, accountOfA, "Compte joint")).toBe(true);
    expect(await archiveAccount(A, accountOfA)).toBe(true);
    expect(await listAccounts(A)).toEqual([]);
  });
});
