"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { removeCategory, saveCategory } from "@/lib/actions/settings";
import { buildCategoryTree, type CategoryKind } from "@/lib/domain/categories";
import {
  CATEGORY_KIND_LABELS,
  categoryInputSchema,
  type CategoryFormValues,
  type CategoryInput,
} from "@/lib/validation/settings";

export type CategoryItem = {
  id: string;
  parentId: string | null;
  name: string;
  kind: CategoryKind;
  position: number;
};

type Mode =
  | { type: "edit"; category: CategoryItem | null; kind: CategoryKind; parentId: string | null }
  | { type: "delete"; category: CategoryItem }
  | null;

export function CategoriesManager({ categories }: { categories: CategoryItem[] }) {
  const [mode, setMode] = useState<Mode>(null);
  const kinds = Object.keys(CATEGORY_KIND_LABELS) as CategoryKind[];

  return (
    <Card>
      <Tabs defaultValue="expense">
        <CardHeader className="flex-wrap">
          <CardTitle>Catégories</CardTitle>
          <TabsList>
            {kinds.map((k) => (
              <TabsTrigger key={k} value={k}>
                {CATEGORY_KIND_LABELS[k]}
              </TabsTrigger>
            ))}
          </TabsList>
        </CardHeader>
        {kinds.map((kind) => {
          const tree = buildCategoryTree(categories.filter((c) => c.kind === kind));
          return (
            <TabsContent key={kind} value={kind} className="px-2 pt-2 pb-2">
              <ul>
                {tree.map((root) => (
                  <li key={root.id} className="border-b border-border last:border-0">
                    <Row
                      name={root.name}
                      onEdit={() =>
                        setMode({ type: "edit", category: root, kind, parentId: root.parentId })
                      }
                      onDelete={() => setMode({ type: "delete", category: root })}
                      onAddChild={() =>
                        setMode({ type: "edit", category: null, kind, parentId: root.id })
                      }
                    />
                    {root.children.length > 0 && (
                      <ul className="pb-1 pl-6">
                        {root.children.map((child) => (
                          <li key={child.id}>
                            <Row
                              name={child.name}
                              muted
                              onEdit={() =>
                                setMode({
                                  type: "edit",
                                  category: child,
                                  kind,
                                  parentId: child.parentId,
                                })
                              }
                              onDelete={() => setMode({ type: "delete", category: child })}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1"
                onClick={() => setMode({ type: "edit", category: null, kind, parentId: null })}
              >
                <Plus aria-hidden /> Nouvelle catégorie
              </Button>
            </TabsContent>
          );
        })}
      </Tabs>

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent {...(mode?.type === "edit" ? { "aria-describedby": undefined } : {})}>
          {mode?.type === "edit" && (
            <CategoryForm
              key={mode.category?.id ?? `new-${mode.parentId}`}
              mode={mode}
              categories={categories}
              onDone={() => setMode(null)}
            />
          )}
          {mode?.type === "delete" && (
            <DeleteCategory
              category={mode.category}
              categories={categories}
              onDone={() => setMode(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Actions de ligne discrètes : visibles au survol et au focus, toujours au tactile. */
const rowAction =
  "pointer-coarse:size-11 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100";

function Row({
  name,
  muted,
  onEdit,
  onDelete,
  onAddChild,
}: {
  name: string;
  muted?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAddChild?: () => void;
}) {
  return (
    <div className="group flex min-h-11 items-center gap-2 rounded-sm px-2 hover:bg-surface-2">
      <button
        type="button"
        onClick={onEdit}
        className={
          muted
            ? "flex-1 text-left text-base text-muted hover:text-text"
            : "flex-1 text-left text-base"
        }
        aria-label={`Modifier ${name}`}
      >
        {name}
      </button>
      {onAddChild && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onAddChild}
          aria-label={`Ajouter une sous-catégorie à ${name}`}
          className={rowAction}
        >
          <Plus aria-hidden />
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={onDelete}
        aria-label={`Supprimer ${name}`}
        className={rowAction}
      >
        <Trash2 aria-hidden />
      </Button>
    </div>
  );
}

function CategoryForm({
  mode,
  categories,
  onDone,
}: {
  mode: Extract<Mode, { type: "edit" }>;
  categories: CategoryItem[];
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const { category, kind } = mode;
  const hasChildren = category ? categories.some((c) => c.parentId === category.id) : false;
  const roots = categories.filter((c) => c.kind === kind && !c.parentId && c.id !== category?.id);
  const form = useForm<CategoryFormValues, unknown, CategoryInput>({
    resolver: zodResolver(categoryInputSchema),
    defaultValues: { name: category?.name ?? "", kind, parentId: mode.parentId ?? "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit() {
    setError(null);
    const r = await saveCategory(category?.id ?? null, form.getValues());
    if (!r.ok) return setError(r.error);
    toast(category ? "Catégorie modifiée." : "Catégorie ajoutée.");
    onDone();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{category ? "Modifier la catégorie" : "Nouvelle catégorie"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-col">
        <div className="flex flex-col gap-4 overflow-y-auto px-5 pb-5">
          <Field label="Nom" error={errors.name?.message}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                autoFocus
                aria-invalid={invalid}
                aria-describedby={describedBy}
                {...form.register("name")}
              />
            )}
          </Field>
          <Field
            label="Catégorie principale"
            error={errors.parentId?.message}
            hint={hasChildren ? "Elle a des sous-catégories : elle reste principale." : undefined}
          >
            {({ id, describedBy, invalid }) => (
              <NativeSelect
                id={id}
                disabled={hasChildren}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                {...form.register("parentId")}
              >
                <option value="">Aucune (catégorie principale)</option>
                {roots.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          {error && (
            <p
              role="alert"
              className="rounded-sm border border-danger/30 px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Annuler
          </Button>
          <Button type="submit" size="sm" variant="primary" disabled={isSubmitting}>
            {category ? "Enregistrer" : "Ajouter"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function DeleteCategory({
  category,
  categories,
  onDone,
}: {
  category: CategoryItem;
  categories: CategoryItem[];
  onDone: () => void;
}) {
  const [replacementId, setReplacementId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const hasChildren = categories.some((c) => c.parentId === category.id);
  const candidates = buildCategoryTree(
    categories.filter((c) => c.kind === category.kind && c.id !== category.id),
  );

  async function onConfirm() {
    setError(null);
    setPending(true);
    const r = await removeCategory({ id: category.id, replacementId });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast(`« ${category.name} » supprimée.`);
    onDone();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Supprimer « {category.name} »</DialogTitle>
        <DialogDescription>
          {hasChildren
            ? "Supprimez ou déplacez d'abord ses sous-catégories."
            : "Ses mouvements, magasins et règles passent sur la catégorie choisie. Ses budgets sont supprimés."}
        </DialogDescription>
      </DialogHeader>
      {!hasChildren && (
        <div className="flex flex-col gap-4 px-5 pb-5">
          <Field label="Remplacer par">
            {({ id }) => (
              <NativeSelect
                id={id}
                value={replacementId}
                onChange={(e) => setReplacementId(e.target.value)}
                autoFocus
              >
                <option value="">Choisir une catégorie…</option>
                {candidates.map((root) => (
                  <optgroup key={root.id} label={root.name}>
                    <option value={root.id}>{root.name}</option>
                    {root.children.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </NativeSelect>
            )}
          </Field>
          {error && (
            <p
              role="alert"
              className="rounded-sm border border-danger/30 px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          )}
        </div>
      )}
      <DialogFooter>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {hasChildren ? "Fermer" : "Annuler"}
        </Button>
        {!hasChildren && (
          <Button
            size="sm"
            variant="danger"
            disabled={!replacementId || pending}
            onClick={onConfirm}
          >
            Supprimer et remplacer
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
