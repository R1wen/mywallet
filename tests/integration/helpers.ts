import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";

/** Crée des utilisateurs de test isolés (ids uniques), à supprimer avec deleteUsers. */
export async function createUsers(count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, () => `test-${randomUUID()}`);
  await db.insert(user).values(ids.map((id) => ({ id, name: "Test", email: `${id}@test.local` })));
  return ids;
}

/** Supprime les utilisateurs ; toutes leurs données suivent par cascade. */
export async function deleteUsers(ids: string[]): Promise<void> {
  if (ids.length) await db.delete(user).where(inArray(user.id, ids));
}
