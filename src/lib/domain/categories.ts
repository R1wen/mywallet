/** Category tree rules (pure, ADR-021): two levels max, children share their parent's kind. */

export type CategoryKind = "expense" | "income" | "transfer";

export type CategoryNode = {
  id: string;
  parentId: string | null;
  name: string;
  kind: CategoryKind;
  position: number;
};

export type CategoryTreeNode<T extends CategoryNode = CategoryNode> = T & {
  children: T[];
};

const byPositionThenName = (a: CategoryNode, b: CategoryNode) =>
  a.position - b.position || a.name.localeCompare(b.name, "fr");

/** Roots with their children, both sorted. An orphan (missing parent) is shown as a root. */
export function buildCategoryTree<T extends CategoryNode>(
  rows: readonly T[],
): CategoryTreeNode<T>[] {
  const ids = new Set(rows.map((r) => r.id));
  const roots = rows.filter((r) => r.parentId === null || !ids.has(r.parentId));
  return [...roots].sort(byPositionThenName).map((root) => ({
    ...root,
    children: rows.filter((r) => r.parentId === root.id).sort(byPositionThenName),
  }));
}

/**
 * Validates a (new or moved) category's parent. `id` is null for a new category.
 * Returns a French error message, or null when allowed.
 */
export function checkCategoryParent(
  all: readonly CategoryNode[],
  input: { id: string | null; parentId: string | null; kind: CategoryKind },
): string | null {
  if (input.parentId === null) return null;
  if (input.parentId === input.id) return "Une catégorie ne peut pas être son propre parent.";
  const parent = all.find((c) => c.id === input.parentId);
  if (!parent) return "Catégorie principale introuvable.";
  if (parent.parentId !== null)
    return "Deux niveaux maximum : choisissez une catégorie principale.";
  if (input.id !== null && all.some((c) => c.parentId === input.id)) {
    return "Cette catégorie a des sous-catégories : elle doit rester principale.";
  }
  if (parent.kind !== input.kind) {
    return "La sous-catégorie doit être de même nature que sa catégorie principale.";
  }
  return null;
}

/** Deleting a category requires a replacement of the same kind and no sub-categories. */
export function checkCategoryDeletion(
  all: readonly CategoryNode[],
  id: string,
  replacementId: string,
): string | null {
  const target = all.find((c) => c.id === id);
  if (!target) return "Catégorie introuvable.";
  if (all.some((c) => c.parentId === id))
    return "Supprimez ou déplacez d'abord ses sous-catégories.";
  if (replacementId === id) return "Choisissez une autre catégorie de remplacement.";
  const replacement = all.find((c) => c.id === replacementId);
  if (!replacement) return "Catégorie de remplacement introuvable.";
  if (replacement.kind !== target.kind)
    return "La catégorie de remplacement doit être de même nature.";
  return null;
}
