# Roadmap myWallet

Légende : `[ ]` à faire · `[~]` en cours · `[x]` terminé (PR fusionnée, CI verte)

| Sprint | Thème                                                                        | Branche               | État         |
| ------ | ---------------------------------------------------------------------------- | --------------------- | ------------ |
| 0      | Fondations                                                                   | `sprint/0-fondations` | [x]          |
| 1      | Cœur : comptes, catégories, transactions, magasins et logos, tableau de bord | `sprint/1-coeur`      | [~] en cours |
| 2      | Récurrent : règles, occurrences, calendrier, reste à vivre                   | `sprint/2-recurrent`  | [ ]          |
| 3      | Import intelligent : OCR gratuit, revue, CSV bancaire, rapprochement         | `sprint/3-import`     | [ ]          |
| 4      | Partage de coûts et créances                                                 | `sprint/4-partage`    | [ ]          |
| 5      | Budgets et objectifs                                                         | `sprint/5-budgets`    | [ ]          |
| 6      | Analyses                                                                     | `sprint/6-analyses`   | [ ]          |
| 7      | Foyers (optionnel, à confirmer)                                              | `sprint/7-foyers`     | [ ]          |
| 8      | Finitions et mise en production                                              | `sprint/8-finitions`  | [ ]          |

## Sprint 0 : Fondations

- [x] pnpm, `src/`, TypeScript strict, ESLint, Prettier, Husky + lint-staged
- [x] Domaine : argent (centimes, format FR, répartition), dates Europe/Paris, marchands (TDD)
- [x] Charte Graphite : tokens, polices, composants de base, page `/design`
- [x] Coquille : barre latérale repliable, barre supérieure, palette ⌘K, barre d'onglets mobile
- [x] Mémoire projet : `CLAUDE.md`, ROADMAP, ADR, skills, agents, hooks, MCP
- [x] Schéma Drizzle complet (19 tables), migration, file de tâches PG, seed FR
- [x] Auth Better Auth (inscription, connexion, déconnexion, sessions, rate limit)
- [x] Tests d'intégration (isolation A/B base + repository, auth), e2e Playwright (8)
- [x] Docker (image testée), `/api/health`
- [x] CI, CD (Vercel + Neon), Dependabot, CodeQL, gitleaks
- [x] Captures, `ui-reviewer` (corrections appliquées), `security-reviewer` (faille CD corrigée)
- [x] `/code-review` (9 corrections appliquées)
- [x] Dépôt GitHub public, PR #1, `/security-review` (aucune vulnérabilité), CI verte (alerte CodeQL ReDoS corrigée)
- [x] Vérifier : récapitulatif, STOP (fusion de la PR #1 par l'utilisateur)

## Sprint 1 : Cœur

- [x] Décisions validées : type `refund` (avoir), remplacement obligatoire d'une catégorie supprimée, logos sans compte (ADR-020 à 023)
- [x] Domaine (TDD) : mouvements signés, flux du mois, dépenses par catégorie, arbre de catégories, résolution de logo, domaines, alias
- [x] Schéma : migration 0001 (avoir, logo importé, cache de favicons), catalogue FR partagé, provisionnement à l'inscription
- [x] Serveur : transactions (filtres, recherche, tri, pagination, virements), catégories, comptes, magasins (stats, fusion, logo), tableau de bord ; isolation A/B testée
- [x] UI : saisie rapide (palette, touche N, bouton mobile), Transactions, Magasins et fiche, Réglages, tableau de bord du mois
- [x] Tests : 216 unitaires (domaine 97 %), 41 intégration, 14 e2e (dépense en moins de 10 s)
- [~] Captures, `ui-reviewer`, `/code-review`
- [ ] PR, CI verte
- [ ] Vérifier : récapitulatif, STOP (puis déploiement Neon + Vercel par l'utilisateur)

### Reporté (décidé au Sprint 0)

- CSP avec nonce dans `proxy.ts` : avant le Sprint 3 (imports de fichiers, logos externes).
- Docker derrière un proxy : configurer `advanced.ipAddress` de Better Auth (IP de confiance) avant tout auto-hébergement exposé.
- Lien optionnel entre un avoir et l'achat d'origine (ADR-020) : à voir avec l'import de tickets (Sprint 3).
- Logo.dev (clé gratuite + attribution) comme source de logos supplémentaire (ADR-022).
- Évals des skills projet (skill-creator) : à lancer quand les skills auront servi sur un sprint.
