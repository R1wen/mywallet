# myWallet — mémoire projet

App web de finances personnelles (FR), sombre, style fintech. Multi-utilisateur, isolation stricte. **Aucun service payant.**
Lire au début de chaque sprint : ce fichier, `docs/ROADMAP.md`, `docs/DECISIONS.md`.

@AGENTS.md

## Stack

- Next.js 16 (App Router, Turbopack, `cacheComponents`, `partialPrefetching`), React 19, TypeScript strict, pnpm.
- Tailwind CSS v4 (tokens dans `src/app/globals.css`), composants style shadcn dans `src/components/ui` (Radix via `radix-ui`).
- PostgreSQL + Drizzle ORM (`src/lib/db`, migrations `drizzle/`). Neon en prod, Docker en local.
- Better Auth (e-mail + mot de passe). Zod 4, React Hook Form.
- Vitest (projets `unit` et `integration`), Testing Library, Playwright e2e.
- Hébergement : Vercel Hobby + Neon Free. OCR exécuté dans le navigateur (Sprint 3).

## Docs Next.js locales

Next 16 diffère de la mémoire d'entraînement. Lire `node_modules/next/dist/docs/` avant d'écrire du code Next.

- `middleware` s'appelle `proxy.ts` (runtime Node, `src/proxy.ts`).
- API de requête asynchrones (`await cookies()`, `await params`).
- Avec `cacheComponents` : toute lecture de session ou de `cookies()` doit être sous `<Suspense>` ; sinon erreur de build.
- `LayoutProps<"/">` / `PageProps<"/x">` sont des types globaux générés : `pnpm typecheck` lance `next typegen`.

## Commandes

```
pnpm dev                 # serveur de dev (http://localhost:3000)
pnpm typecheck           # next typegen + tsc
pnpm lint | pnpm format:check
pnpm test [chemin]       # tests unitaires (rapides) — ne pas utiliser `pnpm exec vitest` (plante avec Vitest 5 + projects)
pnpm test:coverage       # seuil 80 % sur src/lib/domain
pnpm test:int            # intégration, nécessite Postgres (docker compose up -d db)
pnpm e2e                 # Playwright (en local, plus fiable sur un build : pnpm build puis E2E_START_COMMAND="pnpm start")
pnpm db:generate | db:migrate | db:seed
pnpm screens <sprint> <routes...>   # captures 1440/390 -> docs/screens/sprint-N
pnpm ocr:bench [--dir fixtures/receipts-private]   # benchmark OCR (docs/OCR-BENCHMARK.md)
pnpm fixtures:receipts               # régénère les tickets synthétiques (fixtures/receipts)
```

## Structure

- `src/lib/domain/` — logique pure (argent, dates, marchands, créances, récurrences). **TDD, aucun import framework/DB.**
- `src/lib/db/` — schéma Drizzle, client. `src/lib/server/` — dépôts filtrés par `userId` (résultat `Result`).
- `src/lib/actions/` — server actions (`requireUser` + Zod + `refresh()`). `src/lib/validation/` — schémas Zod partagés formulaire/serveur. `src/lib/catalog/` — catégories et enseignes FR par défaut.
- `src/lib/auth/` — Better Auth (serveur + client) et `requireUser()`.
- `src/components/ui/` — primitives. `src/components/shell/` — coquille (sidebar, topbar, ⌘K). `src/components/transactions/` — saisie rapide globale (`useTransactionDialog`).
- Partage (Sprint 4) : `src/lib/domain/claims.ts` (règles), `src/lib/server/sharing.ts` + `shares-sql.ts` (`othersShareSql` = parts des autres), `src/components/sharing/` (éditeur, dialogue Partager), `src/components/people/`, pages `/personnes`.
- Budgets (Sprint 5) : `src/lib/domain/{budgets,categorize}.ts`, `src/lib/server/{budgets,rules,spending}.ts` (`spendingByCategory` = dépense réelle par catégorie, lignes de ticket comprises), `src/components/budgets/`, page `/budgets`.
- Import (Sprint 3) : `src/lib/ocr/` (client : préparation image/PDF, tesseract.js, assets servis depuis `public/vendor` copiés au `postinstall`), `src/lib/domain/receipts/` (parseur + validation), `src/lib/domain/bank-csv.ts`, `src/lib/server/{receipts,bank-import,storage,structurers}.ts`. Le serveur ne reçoit que le texte OCR brut et le reparse. Fixtures publiques synthétiques dans `fixtures/receipts/`, vrais tickets dans `fixtures/receipts-private/` (ignoré).
- `src/app/(app)/` — écrans connectés. `src/app/(auth)/` — connexion, inscription. `src/app/design/` — vitrine dev.
- `tests/integration/`, `e2e/`, `scripts/`, `docs/`.

## Règles absolues

1. **Montants en centimes entiers** (`bigint` en base, `number` en TS). Jamais de flottant. Devise sur chaque montant (EUR par défaut).
2. **Isolation** : toute requête filtre par `userId` issu de la session serveur, jamais d'un paramètre client. Test A/B obligatoire pour chaque nouvelle table.
3. **Validation Zod** de toute entrée (formulaire, server action, route API).
4. Logique financière dans `src/lib/domain` avec tests **avant** l'UI.
5. Aucun secret commité. `.env.example` à jour. Les hooks bloquent l'accès de Claude aux `.env*`.
6. Pas de résultat OCR/IA enregistré sans validation déterministe puis humaine.
7. Format FR : `1 234,56 €`, dates en français, fuseau Europe/Paris (`src/lib/domain/dates.ts`).

## Règles financières (validées)

- Solde = mouvements réels. Un ticket de 80 € débite 80 € même si 30 € concernent un ami.
- Créance en attente : aucun effet sur le solde, comptée à part ("à récupérer").
- Remboursement (total ou partiel, plusieurs fois possible, plafonné au dû, sur n'importe quel compte) : crée une entrée `reimbursement` liée, recrédite le solde, **n'est pas un revenu**.
- Offrir : aucun argent ne revient ; le reste dû devient ma dépense. Annuler un remboursement le supprime, la créance repasse en attente.
- Ma dépense réelle = total − parts dues par d'autres (en attente ou remboursées). Offert = ma dépense.
- Remises et TVA réparties au prorata, arrondi par plus fort reste (`allocateProportionally`).

## Charte Graphite (résumé — détail : skill `mywallet-design-system`)

- Tokens uniquement (`bg`, `surface`, `surface-2`, `border`, `border-strong`, `text`, `muted`, `subtle`, `accent`, `accent-subtle`, `danger`, `warning`). Pas de couleur en dur.
- Un seul accent : entrées d'argent (`+`), actions primaires, focus. Dépenses en texte neutre (`-`). Rouge = erreurs/dépassements seulement.
- Créances : en attente `warning`, remboursé `accent`, offert `muted` (`<ClaimBadge>`).
- Bordures 1 px, aucune ombre, aucun dégradé, aucun glow, pas d'emoji, pas de lorem ipsum.
- Geist Sans 400/500/600 ; montants via `<Amount>` (Geist Mono tabulaire). Échelle `text-xs..2xl` = 12/13/14/16/20/28/40.
- Lignes de tableau 44 px, grille 4 px, transitions 120-180 ms opacité/translation, cibles 44 px en tactile (`pointer-coarse:`).
- `text-subtle` (#5B606A) échoue au contraste AA : réservé au décoratif ou désactivé.

## Conventions

- Un sprint = une branche `sprint/N-nom`, commits conventionnels atomiques, une PR via `gh`, CI verte.
- Écrire les fichiers de code avec l'outil Write/Edit, pas avec des heredocs shell (les `\` sont altérés, y compris dans un script python passé en heredoc : `\b` devient un caractère de contrôle).
- Composants serveur par défaut ; `"use client"` seulement si nécessaire.
- Fin de sprint : tests, CI, captures, `ui-reviewer`, `/code-review`, ROADMAP, récap, STOP.

## Agents et skills projet

- Agents (`.claude/agents/`) : `db-architect`, `ui-reviewer`, `test-writer`, `security-reviewer`, `ocr-benchmarker`.
- Skills (`.claude/skills/`) : `mywallet-design-system`, `mywallet-add-feature`, `mywallet-receipt-fixtures`.
