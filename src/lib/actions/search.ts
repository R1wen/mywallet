"use server";

import { requireUser } from "@/lib/auth/session";
import { searchMyData, type SearchResults } from "@/lib/server/search";

export type { SearchResults };

/** Palette search (⌘K): the session user only. */
export async function searchAction(query: unknown): Promise<SearchResults> {
  const user = await requireUser();
  return searchMyData(user.id, query);
}
