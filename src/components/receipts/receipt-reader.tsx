"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { submitOcr } from "@/lib/actions/imports";
import { loadStoredImage } from "@/lib/ocr/prepare";
import { readReceipt } from "@/lib/ocr/read";

/**
 * Receipt uploaded but not read yet (browser closed during OCR, for instance): read it
 * now, or skip to manual entry.
 */
export function ReceiptReader({ id, mimeType }: { id: string; mimeType: string }) {
  const router = useRouter();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function read() {
    setError(null);
    setProgress(0);
    const source = await loadStoredImage(id, mimeType).catch(() => null);
    const r = await readReceipt(id, source ?? { kind: "none", failure: "ocr_failed" }, setProgress);
    setProgress(null);
    if (!r.ok) setError(r.error);
    router.refresh();
  }

  async function manual() {
    setError(null);
    const r = await submitOcr({ receiptId: id, ocrText: "", ocrEngine: null, failure: "empty" });
    if (!r.ok) setError(r.error);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-muted">
        Ce ticket n&apos;a pas encore été lu. La lecture se fait dans votre navigateur et prend
        quelques secondes.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={progress !== null} onClick={read}>
          {progress === null ? "Lire le ticket" : `Lecture ${Math.round(progress * 100)} %`}
        </Button>
        <Button variant="ghost" disabled={progress !== null} onClick={manual}>
          Saisir à la main
        </Button>
      </div>
    </div>
  );
}
