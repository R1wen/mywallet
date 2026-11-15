# myWallet

Suivi de dépenses personnelles : comptes, transactions, magasins, tickets de caisse (OCR gratuit), flux récurrents, partage de coûts et créances, budgets et analyses. Interface sombre, sobre, en français. 100 % gratuit à héberger (Vercel Hobby + Neon Free).

État d'avancement : [docs/ROADMAP.md](docs/ROADMAP.md) · Décisions : [docs/DECISIONS.md](docs/DECISIONS.md) · Déploiement : [docs/DEPLOY.md](docs/DEPLOY.md)

## Démarrage local

Prérequis : Node 22, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env.local        # puis remplacer BETTER_AUTH_SECRET
docker compose up -d db           # PostgreSQL 17 (bases mywallet et mywallet_test)
pnpm db:migrate
pnpm db:seed                      # données de démonstration (facultatif)
pnpm dev                          # http://localhost:3000
```

Compte de démonstration (créé par le seed, développement uniquement) : `demo@mywallet.local` / `demo-mywallet-2026`.

La vitrine des composants est sur http://localhost:3000/design (désactivée en production).

Tout en Docker : `docker compose up --build` (app + base, migrations au démarrage).

## Commandes

| Commande                                                | Rôle                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                                              | serveur de développement                                       |
| `pnpm lint` · `pnpm format:check` · `pnpm typecheck`    | qualité                                                        |
| `pnpm test` · `pnpm test:coverage`                      | tests unitaires (seuil 80 % sur `src/lib/domain`)              |
| `pnpm test:int`                                         | tests d'intégration sur PostgreSQL (`docker compose up -d db`) |
| `pnpm e2e`                                              | tests de bout en bout Playwright                               |
| `pnpm db:generate` · `pnpm db:migrate` · `pnpm db:seed` | schéma et données                                              |
| `pnpm screens <sprint> <routes…>`                       | captures 1440/390 px dans `docs/screens/`                      |

## Stack

Next.js 16 (App Router), React 19, TypeScript strict, Tailwind CSS 4, Radix, Better Auth, Drizzle ORM, PostgreSQL, Zod, React Hook Form, Vitest, Testing Library, Playwright.

## Sécurité et données

- Mots de passe hachés par Better Auth, sessions en cookie httpOnly, limitation de débit sur la connexion.
- Chaque donnée est rattachée à un utilisateur ; les tests d'intégration vérifient qu'un utilisateur ne peut ni lire ni modifier les données d'un autre.
- Aucun secret dans le dépôt : `.env.example` documente toutes les variables.
