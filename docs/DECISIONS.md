# Décisions d'architecture (ADR)

Format court : contexte, décision, conséquences. Une décision remplacée est marquée « Remplacée par ADR-x ».

## ADR-001 — pnpm et dossier `src/`

- Contexte : le squelette create-next-app utilisait npm et `app/` à la racine. Le cahier des charges impose pnpm.
- Décision : pnpm 10 (`packageManager` épinglé), code applicatif sous `src/`, alias `@/*` vers `src/*`.
- Conséquences : `package-lock.json` supprimé ; scripts de build autorisés explicitement (`pnpm.onlyBuiltDependencies`).

## ADR-002 — Hébergement : Vercel Hobby + Neon Free

- Contexte : contrainte « aucun service payant », app accessible en ligne. AWS n'est plus gratuit au-delà de 6 mois (compte fermé ensuite) ; Oracle Always Free a réduit sa VM ARM à 2 OCPU / 12 Go en 2026 et exige une carte bancaire.
- Décision : Vercel Hobby (usage personnel non commercial) pour Next.js, Neon Free pour PostgreSQL (1 Go/projet, 100 CU-h/mois, aucun dépassement facturé). Stockage objet gratuit derrière `StorageAdapter` (choix au Sprint 3). Docker conservé pour l'auto-hébergement.
- Conséquences : pas de disque persistant ni de processus long côté serveur → OCR exécuté dans le navigateur (ADR-008), file de tâches PG traitée par requêtes courtes / cron Vercel. Neon met la base en veille : premier accès plus lent.

## ADR-003 — Dépôt GitHub public

- Décision : dépôt public, validé par l'utilisateur. CodeQL et protection de branche gratuits.
- Conséquences : aucune donnée réelle ni secret commité ; tickets réels dans `fixtures/receipts-private/` (ignoré) ; gitleaks en CI.

## ADR-004 — Authentification : Better Auth

- Contexte : besoin e-mail + mot de passe, sessions, limitation de débit, sans service tiers.
- Décision : Better Auth 1.7 avec l'adaptateur Drizzle, sessions en base, cookie httpOnly, rate limit en base (fonctionne en serverless).
- Conséquences : tables `user`, `session`, `account`, `verification`, `rate_limit` gérées par le schéma Drizzle du projet. Le `proxy.ts` ne fait qu'une vérification optimiste du cookie ; chaque accès aux données revalide la session (`requireUser()`).

## ADR-005 — Drizzle ORM + node-postgres

- Décision : Drizzle 0.45, driver `pg` (Pool), migrations SQL versionnées par drizzle-kit dans `drizzle/`, appliquées par `scripts/migrate.ts` (CI, CD, Docker).
- Conséquences : même driver en local (Docker) et sur Neon (connexion TCP poolée).

## ADR-006 — Montants en centimes entiers

- Décision : `bigint` (mode number en TS) nommés `*_cents`, colonne `currency char(3)` défaut `EUR`. Formatage via `Intl` fr-FR. Répartitions par la méthode du plus fort reste.
- Conséquences : aucune arithmétique flottante sur l'argent ; limites `Number.MAX_SAFE_INTEGER` largement suffisantes.

## ADR-007 — Cache Components activé

- Contexte : Next 16 active `cacheComponents` et `partialPrefetching` par défaut dans create-next-app.
- Décision : les garder. La coquille (barre latérale, barre supérieure) est prérendue ; tout ce qui lit la session est sous `<Suspense>`.
- Conséquences : lire `cookies()` hors `<Suspense>` casse le build ; les données utilisateur sont mises en cache par `userId` explicite ou non mises en cache.

## ADR-008 — OCR dans le navigateur (à confirmer au spike du Sprint 3)

- Décision provisoire : PaddleOCR (ONNX via onnxruntime-web) en principal, tesseract.js (fra+eng) en repli, exécutés côté client. Le benchmark du Sprint 3 tranche.
- Conséquences : aucun coût serveur ; le fichier original est conservé, le résultat est revalidé côté serveur (Zod + validation déterministe) avant enregistrement.

## ADR-009 — File de tâches PostgreSQL

- Décision : table `jobs` + `SELECT … FOR UPDATE SKIP LOCKED`, traitement par lots courts (compatible serverless).
- Conséquences : pas de Redis ni de worker permanent.

## ADR-010 — Isolation multi-utilisateur

- Décision : `user_id` sur chaque table utilisateur, clés étrangères composites `(user_id, x_id)` vers `(user_id, id)` pour qu'une ligne ne puisse jamais référencer la donnée d'un autre utilisateur ; toutes les requêtes passent par des fonctions qui prennent `userId` de la session.
- Conséquences : un test d'intégration A/B par table.

## ADR-011 — `experimental.agentFeedback` désactivé

- Contexte : l'option prépare des rapports pour l'équipe Next.js et suppose la télémétrie activée.
- Décision : désactivée (application de données financières, aucune remontée externe non nécessaire).

## ADR-012 — Hooks Claude Code en Node

- Décision : hooks écrits en `.mjs` (portables Windows/CI) : garde `.env*` et `rm -r`, format+lint après édition, typecheck + tests domaine en fin de tour si du TypeScript a changé, état de la ROADMAP au démarrage.
- Conséquences : Claude ne peut pas créer `.env.local` ; l'utilisateur le copie depuis `.env.example`.
