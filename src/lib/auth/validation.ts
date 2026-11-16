import { z } from "zod";

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

const email = z
  .string()
  .trim()
  .min(1, "Saisissez votre e-mail.")
  .email("Adresse e-mail invalide.")
  .max(254, "Adresse e-mail trop longue.")
  .transform((v) => v.toLowerCase());

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Saisissez votre mot de passe.").max(PASSWORD_MAX),
});

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Saisissez votre prénom.").max(80, "80 caractères maximum."),
  email,
  password: z
    .string()
    .min(PASSWORD_MIN, `${PASSWORD_MIN} caractères minimum.`)
    .max(PASSWORD_MAX, `${PASSWORD_MAX} caractères maximum.`),
});

export type SignInInput = z.input<typeof signInSchema>;
export type SignUpInput = z.input<typeof signUpSchema>;

/** Traduit les erreurs renvoyées par Better Auth en messages français. */
export function authErrorMessage(error: {
  status?: number;
  code?: string;
  message?: string;
}): string {
  if (error.status === 429) return "Trop de tentatives. Réessayez dans une minute.";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "E-mail ou mot de passe incorrect.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "Un compte existe déjà avec cet e-mail.";
    case "PASSWORD_TOO_SHORT":
      return `Le mot de passe doit contenir au moins ${PASSWORD_MIN} caractères.`;
    case "PASSWORD_TOO_LONG":
      return `Le mot de passe doit contenir au plus ${PASSWORD_MAX} caractères.`;
    case "INVALID_EMAIL":
      return "Adresse e-mail invalide.";
    default:
      // 400 sans code : rejet par nos schémas Zod côté serveur, message déjà en français.
      if (error.status === 400 && !error.code && error.message) return error.message;
      return "Une erreur est survenue. Réessayez.";
  }
}
