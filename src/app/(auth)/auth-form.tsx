"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";
import { safeNextPath } from "@/lib/auth/redirect";
import { authErrorMessage, PASSWORD_MIN, signInSchema, signUpSchema } from "@/lib/auth/validation";

type Mode = "sign-in" | "sign-up";
type AuthValues = { name: string; email: string; password: string };

// Les deux schémas valident le même objet de formulaire ; la connexion ignore `name`.
const resolvers: Record<Mode, Resolver<AuthValues>> = {
  "sign-in": zodResolver(signInSchema) as unknown as Resolver<AuthValues>,
  "sign-up": zodResolver(signUpSchema) as unknown as Resolver<AuthValues>,
};

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const isSignUp = mode === "sign-up";

  const form = useForm<AuthValues>({
    resolver: resolvers[mode],
    defaultValues: { name: "", email: "", password: "" },
    mode: "onSubmit",
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: AuthValues) {
    setFormError(null);
    const { error } = isSignUp
      ? await authClient.signUp.email({
          name: values.name,
          email: values.email,
          password: values.password,
        })
      : await authClient.signIn.email({ email: values.email, password: values.password });
    if (error) {
      setFormError(authErrorMessage(error));
      return;
    }
    router.replace(safeNextPath(params.get("suite")));
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{isSignUp ? "Créer un compte" : "Connexion"}</h1>
        <p className="text-sm text-muted">
          {isSignUp
            ? "Vos données restent privées et liées à votre compte."
            : "Accédez à vos comptes et à vos tickets."}
        </p>
      </div>

      {isSignUp && (
        <Field label="Prénom" error={errors.name?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="given-name"
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("name")}
            />
          )}
        </Field>
      )}

      <Field label="E-mail" error={errors.email?.message}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="email"
            inputMode="email"
            autoComplete="email"
            aria-invalid={invalid}
            aria-describedby={describedBy}
            {...form.register("email")}
          />
        )}
      </Field>

      <Field
        label="Mot de passe"
        error={errors.password?.message}
        hint={isSignUp ? `${PASSWORD_MIN} caractères minimum.` : undefined}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="password"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            {...form.register("password")}
          />
        )}
      </Field>

      {formError && (
        <p
          role="alert"
          className="rounded-sm border border-danger/30 px-3 py-2 text-sm text-danger"
        >
          {formError}
        </p>
      )}

      <Button type="submit" variant="primary" size="lg" disabled={isSubmitting}>
        {isSubmitting
          ? isSignUp
            ? "Création…"
            : "Connexion…"
          : isSignUp
            ? "Créer mon compte"
            : "Se connecter"}
      </Button>

      <p className="text-center text-sm text-muted">
        {isSignUp ? "Déjà un compte ? " : "Pas encore de compte ? "}
        <Link
          href={isSignUp ? "/connexion" : "/inscription"}
          className="inline-flex items-center text-text underline-offset-4 hover:underline pointer-coarse:min-h-11 pointer-coarse:px-1"
        >
          {isSignUp ? "Se connecter" : "Créer un compte"}
        </Link>
      </p>
    </form>
  );
}
