"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { saveImportSettingsAction } from "@/lib/actions/imports";
import { cn } from "@/lib/utils";

type Structurer = "rules" | "ollama" | "gemini";

const OPTIONS: { value: Structurer; title: string; text: string }[] = [
  {
    value: "rules",
    title: "Règles uniquement",
    text: "Lecture dans le navigateur et analyse par des règles. Rien ne quitte ce service.",
  },
  {
    value: "ollama",
    title: "Modèle local Ollama",
    text: "Quand les règles hésitent, un modèle de vision installé sur votre machine relit le ticket. Rien ne quitte votre machine.",
  },
  {
    value: "gemini",
    title: "Gemini (offre gratuite de Google)",
    text: "Quand les règles hésitent, l'image du ticket est envoyée à Google.",
  },
];

/** Choice of the fallback structurer (ADR-029), Gemini behind an explicit warning. */
export function ImportSettings({
  structurer,
  available,
}: {
  structurer: Structurer;
  available: Record<"ollama" | "gemini", boolean>;
}) {
  const [value, setValue] = useState<Structurer>(structurer);
  const [consent, setConsent] = useState(structurer === "gemini");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = value !== structurer;

  async function save() {
    setBusy(true);
    setError(null);
    const r = await saveImportSettingsAction({ structurer: value, geminiConsent: consent });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast("Réglage enregistré.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lecture des tickets</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          role="radiogroup"
          aria-label="Aide à la lecture des tickets"
          className="flex flex-col gap-2"
        >
          {OPTIONS.map((o) => {
            const enabled = o.value === "rules" || available[o.value];
            return (
              <label
                key={o.value}
                className={cn(
                  "flex min-h-11 cursor-pointer gap-3 rounded-sm border border-border px-3 py-2 has-checked:border-accent",
                  !enabled && "cursor-not-allowed opacity-50",
                )}
              >
                <input
                  type="radio"
                  name="structurer"
                  value={o.value}
                  checked={value === o.value}
                  disabled={!enabled}
                  onChange={() => setValue(o.value)}
                  className="mt-1 accent-[var(--accent)]"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-base">{o.title}</span>
                  <span className="text-sm text-muted">
                    {o.text}
                    {!enabled && " Non configuré sur ce serveur."}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {value === "gemini" && (
          <div className="flex flex-col gap-2 rounded-sm border border-warning/30 px-3 py-2">
            <p className="text-sm text-warning">
              L&apos;offre gratuite de Gemini est limitée en nombre de requêtes et Google peut
              utiliser les contenus envoyés (images de vos tickets) pour améliorer ses produits.
              N&apos;activez cette option que si vous l&apos;acceptez.
            </p>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              J&apos;ai compris et j&apos;accepte que mes tickets soient envoyés à Google.
            </label>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div>
          <Button
            variant="primary"
            disabled={!dirty || busy || (value === "gemini" && !consent)}
            onClick={save}
          >
            Enregistrer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
