# Installer myWallet

Trois façons de faire tourner myWallet, toutes gratuites :

| Usage            | Où                                          | Pour qui                        |
| ---------------- | ------------------------------------------- | ------------------------------- |
| Développement    | votre machine (Node + PostgreSQL en Docker) | modifier le code                |
| Auto-hébergement | `docker compose` sur un serveur à vous      | garder tout chez vous           |
| En ligne         | Vercel Hobby + Neon Free                    | l'utiliser partout sans serveur |

## 1. Prérequis

- Node 22 et pnpm 10 (`corepack enable` puis `corepack prepare pnpm@10 --activate`).
- Docker (PostgreSQL 17 en local, ou l'application entière).
- Facultatif : [Ollama](https://ollama.com) pour l'aide à la lecture des tickets et les questions en langage naturel, avec un modèle de vision (`ollama pull qwen2.5vl:7b`, environ 6 Go, 16 Go de RAM conseillés).

## 2. Développement local

```bash
pnpm install                     # copie aussi les fichiers OCR dans public/vendor
cp .env.example .env.local       # puis renseigner BETTER_AUTH_SECRET (voir ci-dessous)
docker compose up -d db          # PostgreSQL sur le port 5433 (bases mywallet et mywallet_test)
pnpm db:migrate
pnpm db:seed                     # facultatif : compte de démonstration
pnpm dev                         # http://localhost:3000
```

Générer un secret : `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

Compte de démonstration : `demo@mywallet.local` / `demo-mywallet-2026` (créé par le seed, jamais en production : le seed refuse une base distante).

## 3. Variables d'environnement

Toutes sont documentées dans `.env.example`.

| Variable                         | Obligatoire   | Rôle                                                                                     |
| -------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `DATABASE_URL`                   | oui           | PostgreSQL (Neon : chaîne « pooled », `sslmode=require`)                                 |
| `BETTER_AUTH_SECRET`             | oui           | 32 caractères aléatoires au moins ; signe les sessions                                   |
| `BETTER_AUTH_URL`                | en production | URL publique en `https://` (origine de confiance, cookies)                               |
| `CRON_SECRET`                    | en production | autorise la purge quotidienne des comptes supprimés (16 caractères au moins)             |
| `OLLAMA_URL`, `OLLAMA_MODEL`     | non           | modèle local pour les tickets et les questions                                           |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | non           | offre gratuite de Gemini ; chaque utilisateur doit l'activer et accepter l'avertissement |

## 4. Tests

```bash
pnpm lint && pnpm typecheck && pnpm test     # unitaires
docker compose up -d db && pnpm test:int     # intégration sur PostgreSQL
pnpm build && E2E_START_COMMAND="pnpm start" pnpm e2e   # bout en bout (dont audit d'accessibilité)
```

## 5. Auto-hébergement avec Docker

```bash
cp .env.example .env              # DATABASE_URL vers le service db, BETTER_AUTH_URL, secrets
docker compose up --build -d      # app + PostgreSQL ; migrations appliquées au démarrage
docker compose --profile ollama up -d   # facultatif : Ollama à côté de l'application
```

- Derrière un proxy (Caddy, Traefik, Nginx) : servir en HTTPS et renseigner `BETTER_AUTH_URL` avec l'URL publique. Configurer l'adresse IP de confiance de Better Auth (`advanced.ipAddress`) pour que la limitation de débit voie l'IP réelle des clients.
- Purge des comptes supprimés : appeler chaque jour `GET /api/cron/purge-accounts` avec l'en-tête `Authorization: Bearer <CRON_SECRET>` (par exemple avec cron et `curl`).
- Sauvegardes : `pg_dump` régulier de la base (les fichiers de tickets y sont stockés).

## 6. En ligne : Vercel + Neon

Procédure détaillée, protections de branche et retour arrière : [DEPLOY.md](DEPLOY.md). En résumé :

1. Neon : projet en Europe, chaîne de connexion « pooled ».
2. Vercel : projet lié au dépôt, variables `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CRON_SECRET`.
3. GitHub : secrets du workflow CD ; chaque fusion sur `main` avec une CI verte migre la base, déploie et vérifie `/api/health`.

## 7. Installer l'application sur un téléphone

myWallet est une application web installable :

- Android (Chrome) : menu ⋮ > « Installer l'application ».
- iPhone (Safari) : Partager > « Sur l'écran d'accueil ».

Le bouton « Prendre une photo » de la page Tickets ouvre directement l'appareil photo. Hors ligne, une page d'attente s'affiche ; aucune donnée financière n'est conservée sur le téléphone par l'application.

## 8. Benchmark OCR sur vos tickets

Déposer au moins 15 photos ou PDF de vrais tickets dans `fixtures/receipts-private/` (ignoré par git), puis `pnpm ocr:bench --dir fixtures/receipts-private`. Seuls des résultats agrégés sont produits ([OCR-BENCHMARK.md](OCR-BENCHMARK.md)).
