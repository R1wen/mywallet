"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { createPersonAction, updatePersonAction } from "@/lib/actions/sharing";
import {
  personInputSchema,
  type PersonInput,
  type PersonInputValues,
} from "@/lib/validation/sharing";

type Person = { id: string; name: string; notes: string | null };

function PersonForm({ person, onDone }: { person: Person | null; onDone: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<PersonInputValues, unknown, PersonInput>({
    resolver: zodResolver(personInputSchema),
    defaultValues: { name: person?.name ?? "", notes: person?.notes ?? "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit() {
    setError(null);
    // Raw values: the action validates them again with the same schema.
    const values = form.getValues();
    const r = person
      ? await updatePersonAction(person.id, values)
      : await createPersonAction(values);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast(person ? "Personne modifiée." : "Personne ajoutée.");
    onDone();
    if (!person && r.data) router.push(`/personnes/${r.data.id}`);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <DialogBody className="flex flex-col gap-3">
        <Field label="Nom" error={errors.name?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="off"
              autoFocus
              maxLength={60}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("name")}
            />
          )}
        </Field>
        <Field
          label="Note"
          error={errors.notes?.message}
          hint="Facultatif : colocataire, collègue…"
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="off"
              maxLength={200}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("notes")}
            />
          )}
        </Field>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Annuler
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={isSubmitting}>
          {isSubmitting ? "Enregistrement…" : person ? "Enregistrer" : "Ajouter"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** "Ajouter une personne" (primary) or "Modifier" (outline) with its dialog. */
export function PersonDialog({ person = null }: { person?: Person | null }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {person ? (
          <Button variant="outline" size="sm">
            <Pencil aria-hidden /> Modifier
          </Button>
        ) : (
          <Button variant="primary" size="sm">
            <UserPlus aria-hidden /> Ajouter une personne
          </Button>
        )}
      </DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{person ? "Modifier la personne" : "Nouvelle personne"}</DialogTitle>
        </DialogHeader>
        {open && <PersonForm person={person} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
