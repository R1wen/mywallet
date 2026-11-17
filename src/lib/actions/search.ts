"use server";

import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { categories, merchants, people, transactions } from "@/lib/db/schema";

export type SearchResults = {
  merchants: { id: string; name: string }[];
  people: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  transactions: { id: string; label: string; occurredOn: string; amountCents: number }[];
};

const EMPTY: SearchResults = { merchants: [], people: [], categories: [], transactions: [] };

/** Escapes LIKE wildcards: the query is matched literally. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Palette search (⌘K) over my merchants, people, categories and movements. */
export async function searchAction(query: unknown): Promise<SearchResults> {
  const user = await requireUser();
  const parsed = z.string().trim().min(2).max(60).safeParse(query);
  if (!parsed.success) return EMPTY;
  const pattern = like(parsed.data);
  const [m, p, c, t] = await Promise.all([
    db
      .select({ id: merchants.id, name: merchants.name })
      .from(merchants)
      .where(and(eq(merchants.userId, user.id), ilike(merchants.name, pattern)))
      .limit(5),
    db
      .select({ id: people.id, name: people.name })
      .from(people)
      .where(
        and(eq(people.userId, user.id), isNull(people.archivedAt), ilike(people.name, pattern)),
      )
      .limit(5),
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(
        and(
          eq(categories.userId, user.id),
          isNull(categories.archivedAt),
          ilike(categories.name, pattern),
        ),
      )
      .limit(5),
    db
      .select({
        id: transactions.id,
        label: transactions.label,
        occurredOn: transactions.occurredOn,
        amountCents: transactions.amountCents,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, user.id),
          or(ilike(transactions.label, pattern), ilike(transactions.notes, pattern)),
        ),
      )
      .orderBy(desc(transactions.occurredOn))
      .limit(5),
  ]);
  return { merchants: m, people: p, categories: c, transactions: t };
}
