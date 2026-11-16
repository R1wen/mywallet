"use client";

import { Camera, Check, FileUp, LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { uploadReceipt } from "@/lib/actions/imports";
import { readReceipt } from "@/lib/ocr/read";
import { prepareReceipt } from "@/lib/ocr/prepare";
import { cn } from "@/lib/utils";

type Phase = "waiting" | "preparing" | "uploading" | "reading" | "done" | "duplicate" | "error";

type Job = {
  key: string;
  name: string;
  phase: Phase;
  progress: number;
  receiptId: string | null;
  message: string | null;
};

const PHASE_LABELS: Record<Phase, string> = {
  waiting: "En attente",
  preparing: "Préparation",
  uploading: "Envoi",
  reading: "Lecture",
  done: "À vérifier",
  duplicate: "Déjà importé",
  error: "Échec",
};

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf";
const MAX_FILES = 20;

/**
 * Drop zone and pickers (multiple files, camera on mobile). Each file is prepared and
 * uploaded, then read one at a time (OCR is heavy). Nothing is saved as a movement here.
 */
export function UploadPanel() {
  const router = useRouter();
  const files = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const update = (key: string, patch: Partial<Job>) =>
    setJobs((list) => list.map((j) => (j.key === key ? { ...j, ...patch } : j)));

  async function handle(list: FileList | File[] | null) {
    const picked = [...(list ?? [])].slice(0, MAX_FILES);
    if (!picked.length || busy) return;
    const batch = picked.map((f, i) => ({
      file: f,
      job: {
        key: `${Date.now()}-${i}`,
        name: f.name || "Photo",
        phase: "waiting" as Phase,
        progress: 0,
        receiptId: null,
        message: null,
      },
    }));
    setJobs((current) => [...batch.map((b) => b.job), ...current].slice(0, 30));
    setBusy(true);
    for (const { file, job } of batch) {
      try {
        update(job.key, { phase: "preparing" });
        const prepared = await prepareReceipt(file);
        update(job.key, { phase: "uploading" });
        const form = new FormData();
        form.set("file", prepared.upload, prepared.filename);
        if (prepared.thumbnail) form.set("thumbnail", prepared.thumbnail, "thumbnail.jpg");
        const uploaded = await uploadReceipt(form);
        if (!uploaded.ok) {
          update(job.key, { phase: "error", message: uploaded.error });
          continue;
        }
        if (uploaded.data.duplicate) {
          update(job.key, { phase: "duplicate", receiptId: uploaded.data.id });
          continue;
        }
        update(job.key, { phase: "reading", receiptId: uploaded.data.id });
        const read = await readReceipt(uploaded.data.id, prepared.ocr, (p) =>
          update(job.key, { progress: p }),
        );
        update(job.key, read.ok ? { phase: "done" } : { phase: "error", message: read.error });
      } catch {
        update(job.key, { phase: "error", message: "Fichier illisible par le navigateur." });
      }
    }
    setBusy(false);
    router.refresh();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void handle(e.dataTransfer.files);
  }

  return (
    <Card className="border-dashed border-border-strong">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center gap-3 rounded-md px-4 py-10 text-center transition-colors duration-[var(--duration-fast)]",
          dragging && "bg-accent-subtle",
        )}
      >
        <p className="text-base text-text">Déposez vos tickets ici</p>
        <p className="max-w-md text-sm text-muted">
          Photos (JPG, PNG, WebP, HEIC) ou factures PDF, 4 Mo maximum chacune. La lecture se fait
          dans votre navigateur.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => camera.current?.click()}
            className="md:hidden"
          >
            <Camera /> Prendre une photo
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => files.current?.click()}>
            <FileUp /> Choisir des fichiers
          </Button>
        </div>
        <input
          ref={files}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          aria-label="Choisir des tickets"
          onChange={(e) => {
            void handle(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          aria-label="Prendre un ticket en photo"
          onChange={(e) => {
            void handle(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {jobs.length > 0 && (
        <ul
          role="list"
          aria-live="polite"
          className="divide-y divide-border border-t border-border"
        >
          {jobs.map((j) => (
            <li key={j.key} className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm">
              <JobIcon phase={j.phase} />
              <span className="min-w-0 flex-1 truncate text-text">{j.name}</span>
              <span className={cn("shrink-0", j.phase === "error" ? "text-danger" : "text-muted")}>
                {j.phase === "error" && j.message
                  ? j.message
                  : j.phase === "reading" && j.progress > 0
                    ? `Lecture ${Math.round(j.progress * 100)} %`
                    : PHASE_LABELS[j.phase]}
              </span>
              {j.receiptId && (j.phase === "done" || j.phase === "duplicate") && (
                <Link
                  href={`/tickets/${j.receiptId}`}
                  className="shrink-0 text-accent underline-offset-4 hover:underline"
                >
                  Ouvrir
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function JobIcon({ phase }: { phase: Phase }) {
  if (phase === "done" || phase === "duplicate")
    return <Check className="size-4 text-muted" aria-hidden />;
  if (phase === "error") return <TriangleAlert className="size-4 text-danger" aria-hidden />;
  return (
    <LoaderCircle
      className={cn(
        "size-4 text-muted",
        phase !== "waiting" && "animate-spin motion-reduce:animate-none",
      )}
      aria-hidden
    />
  );
}
