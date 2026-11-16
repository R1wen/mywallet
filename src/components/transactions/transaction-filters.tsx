"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { TX_KIND_LABELS } from "@/lib/validation/transaction";

type Option = { id: string; name: string; parentId?: string | null };

const FILTER_KEYS = ["q", "compte", "categorie", "type", "du", "au", "marchand"] as const;

/** Filters live in the URL (shareable, back button works); the server reads them. */
export function TransactionFilters({
  accounts,
  categories,
}: {
  accounts: Option[];
  categories: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  function onSearch(value: string) {
    setQ(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => update({ q: value.trim() || null }), 250);
  }

  const active = FILTER_KEYS.some((k) => params.get(k));
  const roots = categories.filter((c) => !c.parentId);

  return (
    <div
      className="grid grid-cols-2 gap-2 border-b border-border p-3 md:flex md:flex-wrap md:items-center"
      aria-busy={pending}
      role="search"
    >
      <div className="relative col-span-2 min-w-48 flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Rechercher un libellé, un magasin, une note…"
          aria-label="Rechercher"
          className="pl-8"
        />
      </div>
      <NativeSelect
        aria-label="Compte"
        value={params.get("compte") ?? ""}
        onChange={(e) => update({ compte: e.target.value })}
        className="md:w-auto"
      >
        <option value="">Comptes</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        aria-label="Catégorie"
        value={params.get("categorie") ?? ""}
        onChange={(e) => update({ categorie: e.target.value })}
        className="md:w-auto md:max-w-56"
      >
        <option value="">Catégories</option>
        {roots.map((root) => {
          const children = categories.filter((c) => c.parentId === root.id);
          return children.length ? (
            <optgroup key={root.id} label={root.name}>
              <option value={root.id}>{root.name} (tout)</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ) : (
            <option key={root.id} value={root.id}>
              {root.name}
            </option>
          );
        })}
      </NativeSelect>
      <NativeSelect
        aria-label="Type"
        value={params.get("type") ?? ""}
        onChange={(e) => update({ type: e.target.value })}
        className="md:w-auto"
      >
        <option value="">Types</option>
        {Object.entries(TX_KIND_LABELS).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </NativeSelect>
      <div className="col-span-2 flex items-center gap-1">
        <Input
          type="date"
          aria-label="Du"
          value={params.get("du") ?? ""}
          onChange={(e) => update({ du: e.target.value })}
          className="min-w-0 flex-1 [color-scheme:dark] md:w-auto md:flex-none"
        />
        <span className="text-muted" aria-hidden>
          –
        </span>
        <Input
          type="date"
          aria-label="Au"
          value={params.get("au") ?? ""}
          onChange={(e) => update({ au: e.target.value })}
          className="min-w-0 flex-1 [color-scheme:dark] md:w-auto md:flex-none"
        />
      </div>
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            startTransition(() => router.replace(pathname, { scroll: false }));
          }}
        >
          <X aria-hidden /> Effacer
        </Button>
      )}
    </div>
  );
}
