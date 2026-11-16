import { describe, expect, it } from "vitest";
import {
  buildCategoryTree,
  checkCategoryDeletion,
  checkCategoryParent,
  type CategoryNode,
} from "./categories";

const cats: CategoryNode[] = [
  { id: "alim", parentId: null, name: "Alimentation", kind: "expense", position: 0 },
  { id: "courses", parentId: "alim", name: "Courses", kind: "expense", position: 1 },
  { id: "resto", parentId: "alim", name: "Restaurants", kind: "expense", position: 0 },
  { id: "transport", parentId: null, name: "Transports", kind: "expense", position: 1 },
  { id: "revenus", parentId: null, name: "Revenus", kind: "income", position: 2 },
  { id: "salaire", parentId: "revenus", name: "Salaire", kind: "income", position: 0 },
];

describe("buildCategoryTree", () => {
  it("nests children under roots, ordered by position then name", () => {
    const tree = buildCategoryTree(cats);
    expect(tree.map((n) => n.id)).toEqual(["alim", "transport", "revenus"]);
    expect(tree[0]!.children.map((n) => n.id)).toEqual(["resto", "courses"]);
    expect(tree[1]!.children).toEqual([]);
  });

  it("treats an orphan (missing parent) as a root instead of dropping it", () => {
    const tree = buildCategoryTree([
      { id: "x", parentId: "gone", name: "Orphan", kind: "expense", position: 0 },
    ]);
    expect(tree.map((n) => n.id)).toEqual(["x"]);
  });
});

describe("checkCategoryParent", () => {
  it.each([
    ["new root", null, null, "expense", null],
    ["new child of a root", null, "alim", "expense", null],
    ["move a leaf under another root", "courses", "transport", "expense", null],
    [
      "parent is itself",
      "alim",
      "alim",
      "expense",
      "Une catégorie ne peut pas être son propre parent.",
    ],
    [
      "parent is a sub-category",
      null,
      "courses",
      "expense",
      "Deux niveaux maximum : choisissez une catégorie principale.",
    ],
    [
      "category with children cannot become a child",
      "alim",
      "transport",
      "expense",
      "Cette catégorie a des sous-catégories : elle doit rester principale.",
    ],
    [
      "kind must match the parent",
      null,
      "revenus",
      "expense",
      "La sous-catégorie doit être de même nature que sa catégorie principale.",
    ],
    ["unknown parent", null, "nope", "expense", "Catégorie principale introuvable."],
  ] as const)("%s", (_label, id, parentId, kind, expected) => {
    expect(checkCategoryParent(cats, { id, parentId, kind })).toBe(expected);
  });
});

describe("checkCategoryDeletion", () => {
  it("accepts a replacement of the same kind", () => {
    expect(checkCategoryDeletion(cats, "courses", "resto")).toBeNull();
    expect(checkCategoryDeletion(cats, "courses", "transport")).toBeNull();
  });

  it.each([
    ["alim", "transport", "Supprimez ou déplacez d'abord ses sous-catégories."],
    ["courses", "courses", "Choisissez une autre catégorie de remplacement."],
    ["courses", "salaire", "La catégorie de remplacement doit être de même nature."],
    ["courses", "nope", "Catégorie de remplacement introuvable."],
    ["nope", "resto", "Catégorie introuvable."],
  ])("%s -> %s refused", (id, replacement, expected) => {
    expect(checkCategoryDeletion(cats, id, replacement)).toBe(expected);
  });
});
