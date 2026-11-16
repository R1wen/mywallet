# Roadmap myWallet

Légende : `[ ]` à faire · `[~]` en cours · `[x]` terminé (PR fusionnée, CI verte)

| Sprint | Thème                                                                        | Branche               | État         |
| ------ | ---------------------------------------------------------------------------- | --------------------- | ------------ |
| 0      | Fondations                                                                   | `sprint/0-fondations` | [x]          |
| 1      | Cœur : comptes, catégories, transactions, magasins et logos, tableau de bord | `sprint/1-coeur`      | [x]          |
| 2      | Récurrent : règles, occurrences, calendrier, reste à vivre                   | `sprint/2-recurrent`  | [x]          |
| 3      | Import intelligent : OCR gratuit, revue, CSV bancaire, rapprochement         | `sprint/3-import`     | [~] en cours |
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
- [x] Tests : 217 unitaires (domaine 97 %), 44 intégration, 14 e2e (dépense en moins de 10 s)
- [x] Captures (`docs/screens/sprint-1/`), `ui-reviewer` (2 itérations, tous les écrans validés), `/code-review` (10 corrections appliquées)
- [x] PR #2, CI verte
- [x] Vérifier : récapitulatif, STOP
- [x] Déploiement : Neon (Francfort) + Vercel, https://mywallet-priv.vercel.app, CD vert (PR #3 : variables vides au build)

## Sprint 2 : Récurrent

- [x] Décisions validées : échéances prévues puis validées, reste à vivre = solde disponible − charges restantes + revenus attendus, épargne = virement (ADR-024 à 026)
- [x] Domaine (TDD) : dates de récurrence (jours 29 à 31, bissextiles, hebdo/mensuel/annuel, intervalle), curseur de génération idempotent, reste à vivre et montant utilisable par jour
- [x] Schéma : migration 0002 additive (`recurring_occurrences`, compte d'épargne sur la règle)
- [x] Serveur : règles (CRUD), génération paresseuse sans doublon (verrou + unicité), validation avec montant réel, ignorer, annuler ; isolation A/B testée
- [x] UI : écran Récurrent (calendrier, agenda mobile, règles), fenêtres règle et échéance, carte reste à vivre du tableau de bord
- [x] Tests : domaine, validation, composant formulaire de règle, 18 intégration, e2e (règle due aujourd'hui validée depuis le tableau de bord)
- [x] Captures (`docs/screens/sprint-2/`), `ui-reviewer` (corrections : cibles tactiles 44 px des boutons, prochaine échéance réelle, signe des revenus validés, mise en page mobile)
- [x] `/code-review` (10 corrections : jambe débitrice stable d'un virement, replanification sans doublon dans un mois validé, échéances en retard suivant le type de la règle, libellé d'épargne, requêtes en double)
- [x] PR #4, CI verte
- [x] Vérifier : récapitulatif, STOP (fusion de la PR #4 par l'utilisateur)

## Sprint 3 : Import intelligent

- [x] Décisions validées : fichiers dans PostgreSQL, rapprochement sans doublon, structuration règles + Ollama + Gemini, fixtures synthétiques (ADR-027 à 030)
- [x] CSP (ADR-031) : fixe, limitée à l'origine ; nonce écarté (incompatible avec Cache Components)
- [x] Domaine (TDD) : signature des fichiers, parseur de tickets FR, validation déterministe et confiance, doublons, CSV bancaire, rapprochement
- [x] Fixtures : 18 tickets synthétiques (16 images, 2 PDF) avec résultats attendus et sorties OCR
- [x] Spike OCR (`ocr-benchmarker`) : tesseract.js par défaut, PaddleOCR non livré (ADR-008, `docs/OCR-BENCHMARK.md`) ; parseur 18/18 sur total et date
- [ ] Benchmark sur les vrais tickets (`fixtures/receipts-private/`, à déposer par l'utilisateur)
- [x] Schéma : fichiers, rapprochement, préréglages CSV, réglages d'import (migration 0003 additive)
- [x] Serveur : dépôt, revue, validation, rejet, import CSV, rapprochement ; isolation A/B testée
- [x] UI : dépôt multiple et photo mobile, file des tickets, écran de revue, import CSV, réglages
- [x] Structureurs Ollama et Gemini (désactivés sans configuration, Gemini avec consentement)
- [x] Tests : 557 unitaires (dont non-régression du parseur sur les 18 fixtures et entrées hostiles), 90 intégration, 20 e2e (ticket lu dans le navigateur, relevé CSV)
- [x] Captures (`docs/screens/sprint-3/`), `ui-reviewer` (2 passes), `security-reviewer` (ReDoS du parseur, appels de modèle, quotas, garde de rattachement : corrigés), `/code-review` (9 corrections)
- [ ] Import CSV : un virement reçu qui rembourse une créance est créé en revenu (lien avec les créances au Sprint 4)
- [x] PR #5, CI verte (alerte CodeQL corrigée)
- [ ] Vérifier : récapitulatif, STOP

### Reporté (décidé au Sprint 0)

- Docker derrière un proxy : configurer `advanced.ipAddress` de Better Auth (IP de confiance) avant tout auto-hébergement exposé.
- Lien optionnel entre un avoir et l'achat d'origine (ADR-020).
- Repli OCR PaddleOCR (31 Mo de modèles à auto-héberger) : selon le benchmark sur les vrais tickets.
- Catégorie au niveau de l'article et apprentissage des corrections (import, Sprint 3) : avec les budgets (Sprint 5).
- Logo.dev (clé gratuite + attribution) comme source de logos supplémentaire (ADR-022).
- RGPD : export complet des données (y compris fichiers de tickets) et suppression du compte : Sprint 8.
- Override pnpm d’esbuild ≥ 0.25 (avis modéré, dépendance de développement de drizzle-kit).
- Évals des skills projet (skill-creator) : à lancer quand les skills auront servi sur un sprint.
