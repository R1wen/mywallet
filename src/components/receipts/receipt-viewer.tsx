"use client";

import { FileText, Maximize2, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const STEPS = [1, 1.5, 2, 3, 4];

/**
 * Receipt image with zoom (buttons, 1x to 4x) and native scrolling to pan. PDFs open
 * in a new tab (served sandboxed) rather than in an embedded viewer.
 */
export function ReceiptViewer({ id, mimeType }: { id: string; mimeType: string }) {
  const [step, setStep] = useState(0);
  const src = `/api/receipts/${id}/original`;
  const zoom = STEPS[step] ?? 1;

  if (mimeType === "application/pdf" || mimeType === "image/heic") {
    return (
      <div className="flex h-full min-h-60 flex-col items-center justify-center gap-3 rounded-md border border-border bg-surface p-6 text-center">
        <FileText className="size-6 text-muted" aria-hidden />
        <p className="text-sm text-muted">
          {mimeType === "application/pdf"
            ? "Facture PDF."
            : "Photo HEIC : aperçu indisponible dans ce navigateur."}
        </p>
        <Button asChild size="sm" variant="outline">
          <a href={src} target="_blank" rel="noopener noreferrer">
            Ouvrir le fichier
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="px-1 text-xs text-muted tabular-nums">{Math.round(zoom * 100)} %</span>
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Réduire"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            <Minus />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Agrandir"
            disabled={step === STEPS.length - 1}
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          >
            <Plus />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Taille d'origine"
            onClick={() => setStep(0)}
          >
            <Maximize2 />
          </Button>
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto"
        tabIndex={0}
        aria-label="Image du ticket, faire défiler pour se déplacer"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- private, per-user file */}
        <img
          src={src}
          alt="Ticket"
          style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
          className="block h-auto"
          draggable={false}
        />
      </div>
    </div>
  );
}
