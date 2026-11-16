# Déploiement myWallet (Vercel Hobby + Neon Free)

Le déploiement est automatique : à chaque push sur `main`, la CI tourne ; si elle est verte, le workflow `CD` applique les migrations sur Neon, déploie sur Vercel et vérifie `/api/health`. Les déploiements automatiques de Vercel par Git sont désactivés (`vercel.json`) pour que rien ne parte sans CI verte.

## Mise en place (une seule fois)

1. **Neon** (https://neon.tech, gratuit, sans carte) : créer un projet, région Europe (Francfort). Copier la chaîne de connexion **poolée** (`...-pooler...?sslmode=require`).
2. **Vercel** (https://vercel.com, plan Hobby) : importer le dépôt GitHub, framework Next.js. Région des fonctions : Paris (`cdg1`, déjà dans `vercel.json`).
3. Variables d'environnement Vercel (Production) :
   - `DATABASE_URL` = chaîne Neon
   - `BETTER_AUTH_SECRET` = `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
   - `BETTER_AUTH_URL` = URL de production (ex. `https://mywallet-xxx.vercel.app`)
4. Jeton Vercel : Account Settings > Tokens. Identifiants : `pnpm dlx vercel link` puis lire `.vercel/project.json` (`orgId`, `projectId`).
5. Secrets GitHub (Settings > Secrets and variables > Actions), dans l'environnement `production` :
   - `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
   - `PRODUCTION_DATABASE_URL` (même chaîne Neon, utilisée pour les migrations)
   - Variable (onglet Variables) `PRODUCTION_URL` = domaine public de production, pour la vérification de santé (l'URL brute d'un déploiement est protégée par Vercel et répond 401)
6. Environnement GitHub `production` (Settings > Environments) : restreindre aux branches `main`, ajouter vous-même comme reviewer requis si vous voulez valider chaque mise en production.

Tant que ces secrets manquent, le job de déploiement s'arrête avec un avertissement (l'image Docker est quand même publiée sur GHCR).

## Protection de branche recommandée (`main`)

Settings > Branches (ou Rulesets) :

- Exiger une pull request avant fusion.
- Exiger les vérifications : `Lint, format, typecheck`, `Unit and integration tests`, `Production build`, `End-to-end (Playwright)`, `Dependency audit and secret scan`, `Analyze (javascript-typescript)`.
- Exiger une branche à jour avant fusion.
- Interdire les force-push et la suppression.

Claude peut l'appliquer via `gh api` sur demande.

## Migrations

- Générées par `pnpm db:generate`, revues, commitées dans `drizzle/`.
- Appliquées avant le déploiement : elles doivent être **additives** (ajout de colonnes nullable, de tables, d'index). Une suppression ou un renommage se fait en deux temps (expand/contract) sur deux déploiements, pour que la version précédente continue de fonctionner pendant la bascule et en cas de retour arrière.

## Retour arrière

1. Application : Vercel > Deployments > déploiement précédent > « Promote to Production » (ou `pnpm dlx vercel rollback <url> --token …`). Instantané, sans rebuild.
2. Base : les migrations étant additives, l'ancienne version fonctionne sur le nouveau schéma. Si une migration est en cause, Neon permet de restaurer une branche à un instant donné (Branches > Restore ; la fenêtre d'historique du plan gratuit est courte, vérifier sa durée dans la console Neon) : à faire seulement après accord, car les écritures postérieures sont perdues.
3. Corriger sur une branche, PR, CI verte, fusion : le CD redéploie.

## Auto-hébergement (option)

`docker compose up --build` lance l'app et PostgreSQL ; l'image publiée est `ghcr.io/<owner>/mywallet:latest` (`RUN_MIGRATIONS=1` applique les migrations au démarrage).
