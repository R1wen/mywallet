"use client";

import { Archive, ArchiveRestore, Copy, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useShareDialog } from "@/components/sharing/share-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  archivePersonAction,
  cancelPaymentAction,
  claimAction,
  deletePersonAction,
} from "@/lib/actions/sharing";
import { reminderMessage, type ReminderGroup } from "@/lib/domain/claims";

/** Offrir / Annuler / Rouvrir on one claim (each is reversible). */
export function ClaimActionButton({
  claimId,
  action,
  label,
  description,
}: {
  claimId: string;
  action: "gift" | "cancel" | "reopen";
  label: string;
  /** Accessible name with the claim context. */
  description: string;
}) {
  const [pending, start] = useTransition();
  const done = {
    gift: "Créance offerte.",
    cancel: "Créance annulée.",
    reopen: "Créance rouverte.",
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={description}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await claimAction({ claimId, action });
          toast(r.ok ? done[action] : r.error);
        })
      }
    >
      {label}
    </Button>
  );
}

/** Cancels a reimbursement (deletes its movement); asks for a second click. */
export function CancelPaymentButton({
  transactionId,
  label,
}: {
  transactionId: string;
  label: string;
}) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant={confirm ? "danger" : "ghost"}
      size="sm"
      aria-label={confirm ? `Confirmer l'annulation : ${label}` : `Annuler : ${label}`}
      disabled={pending}
      onBlur={() => setConfirm(false)}
      onClick={() => {
        if (!confirm) {
          setConfirm(true);
          return;
        }
        start(async () => {
          const r = await cancelPaymentAction(transactionId);
          toast(r.ok ? "Remboursement annulé : la somme est de nouveau due." : r.error);
          setConfirm(false);
        });
      }}
    >
      {confirm ? "Confirmer" : "Annuler"}
    </Button>
  );
}

export function EditShareButton({
  transactionId,
  label,
}: {
  transactionId: string;
  label: string;
}) {
  const { openShare } = useShareDialog();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`Modifier le partage : ${label}`}
      onClick={() => openShare(transactionId)}
    >
      <Users aria-hidden /> Partage
    </Button>
  );
}

/** Shows the reminder text and copies it to the clipboard. */
export function ReminderButton({
  personName,
  groups,
}: {
  personName: string;
  groups: ReminderGroup[];
}) {
  const text = reminderMessage(personName, groups);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast("Message copié.");
    } catch {
      toast("Copie impossible : sélectionnez le texte et copiez-le.");
    }
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Copy aria-hidden /> Message de relance
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Message de relance</DialogTitle>
          <DialogDescription>
            À envoyer à {personName} par le moyen de votre choix.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Textarea
            readOnly
            aria-label="Texte du message"
            value={text}
            rows={Math.min(14, text.split("\n").length + 1)}
            className="min-h-40 font-sans"
            onFocus={(e) => e.currentTarget.select()}
          />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="primary" size="sm" onClick={copy}>
            <Copy aria-hidden /> Copier le message
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Archive (hide from the share choices) or delete a person without history. */
export function PersonAdminButtons({
  personId,
  archived,
  hasHistory,
}: {
  personId: string;
  archived: boolean;
  hasHistory: boolean;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await archivePersonAction(personId, !archived);
            toast(r.ok ? (archived ? "Personne réactivée." : "Personne archivée.") : r.error);
          })
        }
      >
        {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
        {archived ? "Réactiver" : "Archiver"}
      </Button>
      {!hasHistory && (
        <Button
          type="button"
          variant={confirm ? "danger" : "ghost"}
          size="sm"
          disabled={pending}
          onBlur={() => setConfirm(false)}
          onClick={() => {
            if (!confirm) {
              setConfirm(true);
              return;
            }
            start(async () => {
              const r = await deletePersonAction(personId);
              if (!r.ok) {
                toast(r.error);
                return;
              }
              toast("Personne supprimée.");
              router.push("/personnes");
            });
          }}
        >
          <Trash2 aria-hidden /> {confirm ? "Confirmer la suppression" : "Supprimer"}
        </Button>
      )}
    </>
  );
}
