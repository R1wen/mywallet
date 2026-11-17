# Roadmap myWallet

Légende : `[ ]` à faire · `[~]` en cours · `[x]` terminé (PR fusionnée, CI verte)

| Sprint | Thème                                                                        | Branche               | État         |
| ------ | ---------------------------------------------------------------------------- | --------------------- | ------------ |
| 0      | Fondations                                                                   | `sprint/0-fondations` | [x]          |
| 1      | Cœur : comptes, catégories, transactions, magasins et logos, tableau de bord | `sprint/1-coeur`      | [x]          |
| 2      | Récurrent : règles, occurrences, calendrier, reste à vivre                   | `sprint/2-recurrent`  | [x]          |
| 3      | Import intelligent : OCR gratuit, revue, CSV bancaire, rapprochement         | `sprint/3-import`     | [x]          |
| 4      | Partage de coûts et créances                                                 | `sprint/4-partage`    | [x]          |
| 5      | Budgets et objectifs                                                         | `sprint/5-budgets`    | [~] en cours |
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
- [ ] Benchmark sur les vrais tickets (`fixtures/receipts-private/`) : reporté à la fin du projet, à la demande de l'utilisateur
- [x] Schéma : fichiers, rapprochement, préréglages CSV, réglages d'import (migration 0003 additive)
- [x] Serveur : dépôt, revue, validation, rejet, import CSV, rapprochement ; isolation A/B testée
- [x] UI : dépôt multiple et photo mobile, file des tickets, écran de revue, import CSV, réglages
- [x] Structureurs Ollama et Gemini (désactivés sans configuration, Gemini avec consentement)
- [x] Tests : 557 unitaires (dont non-régression du parseur sur les 18 fixtures et entrées hostiles), 90 intégration, 20 e2e (ticket lu dans le navigateur, relevé CSV)
- [x] Captures (`docs/screens/sprint-3/`), `ui-reviewer` (2 passes), `security-reviewer` (ReDoS du parseur, appels de modèle, quotas, garde de rattachement : corrigés), `/code-review` (9 corrections)
- [x] Import CSV : un virement reçu qui rembourse une créance (fait au Sprint 4, ADR-035)
- [x] PR #5, CI verte (alerte CodeQL corrigée)
- [x] Vérifier : récapitulatif, STOP (fusion de la PR #5 par l'utilisateur ; benchmark réel reporté à la fin du projet)

## Sprint 4 : Partage de coûts et créances

- [x] Décisions validées : imputation du plus ancien au plus récent, virement CSV proposé puis confirmé, annulation avec historique, centime restant pour moi (ADR-032 à 035)
- [x] Domaine (TDD) : remises au prorata, parts égales, TVA, cycle de vie des créances, imputation, message de relance, suggestions de remboursement ; « ma dépense réelle » dans les flux
- [x] Serveur : personnes, partage par ligne ou global (à la validation du ticket ou après), remboursements, offrir, annuler, rouvrir, annulation d'un remboursement, gardes sur les dépenses partagées, import CSV ; isolation A/B testée (aucune migration)
- [x] UI : étape « Tout est à moi ? », dialogue Partager, Personnes et fiche (relance, remboursement), carte « À récupérer », import CSV
- [x] Tests : 605 unitaires, 115 intégration (partiel, offert, annulation, ticket entièrement partagé), 22 e2e (attribution à un ami puis remboursement)
- [x] Captures (`docs/screens/sprint-4/`), `ui-reviewer`
- [x] `/code-review` (10 corrections : verrou puis relecture des paiements concurrents, total de remboursement invalide, double import, montant d'une dépense partagée, rattachement à un mouvement partagé, offre puis annulation de remboursement, personnes archivées, requêtes du tableau de bord et de l'import, prédicat de verrou dans le domaine)
- [x] PR #6, CI verte
- [x] Vérifier : récapitulatif, STOP (fusion de la PR #6 par l'utilisateur)

## Sprint 5 : Budgets et objectifs

- [x] Décisions validées : pas de report, alertes dans l'app à seuil réglable, règles proposées puis confirmées, catégorie par ligne de ticket (ADR-036 à 038)
- [x] Domaine (TDD) : périodes, statut et seuils, rythme, sous-catégories, objectifs, normalisation et mots-clés, règles, dépense réelle par catégorie avec lignes
- [x] Schéma : migration 0004 additive (seuil d'alerte, une règle par magasin ou mot-clé)
- [x] Serveur : budgets, alertes, objectifs, règles appliquées à la saisie, à l'import CSV et aux tickets, propositions après correction ; isolation A/B testée
- [x] UI : écran Budgets et objectifs, bandeau et badge d'alertes, message de seuil, proposition de règle, catégorie par ligne de ticket, règles dans Réglages
- [x] Tests : 650 unitaires, 133 intégration, 24 e2e ; captures (`docs/screens/sprint-5/`), `ui-reviewer` (lignes de ticket compactes sur mobile, badge d'alerte en warning), `/code-review` (10 corrections : fusion de magasins avec règles, alertes répétées à la modification, « Comme le ticket » respecté, un seul budget ouvert par catégorie et période (migration 0005), période modifiée, requêtes du tableau de bord, règles en une transaction, SQL de part partagé)
- [ ] PR, CI verte
- [ ] Vérifier : récapitulatif, STOP

### Reporté (décidé au Sprint 0)

- Docker derrière un proxy : configurer `advanced.ipAddress` de Better Auth (IP de confiance) avant tout auto-hébergement exposé.
- Lien optionnel entre un avoir et l'achat d'origine (ADR-020).
- Repli OCR PaddleOCR (31 Mo de modèles à auto-héberger) : selon le benchmark sur les vrais tickets.
- Logo.dev (clé gratuite + attribution) comme source de logos supplémentaire (ADR-022).
- RGPD : export complet des données (y compris fichiers de tickets) et suppression du compte : Sprint 8.
- Override pnpm d’esbuild ≥ 0.25 (avis modéré, dépendance de développement de drizzle-kit).
- Évals des skills projet (skill-creator) : à lancer quand les skills auront servi sur un sprint.
