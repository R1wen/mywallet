# Roadmap myWallet

Légende : `[ ]` à faire · `[~]` en cours · `[x]` terminé (PR fusionnée, CI verte)

| Sprint | Thème                                                                        | Branche               | État         |
| ------ | ---------------------------------------------------------------------------- | --------------------- | ------------ |
| 0      | Fondations                                                                   | `sprint/0-fondations` | [~] en cours |
| 1      | Cœur : comptes, catégories, transactions, magasins et logos, tableau de bord | `sprint/1-coeur`      | [ ]          |
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
- [~] Mémoire projet : `CLAUDE.md`, ROADMAP, ADR, skills, agents, hooks, MCP
- [ ] Schéma Drizzle complet, migrations, file de tâches PG, seed FR
- [ ] Auth Better Auth (inscription, connexion, déconnexion, sessions, rate limit)
- [ ] Tests d'intégration (isolation A/B), e2e Playwright
- [ ] Docker, `/api/health`
- [ ] CI, CD (Vercel + Neon), Dependabot, CodeQL, gitleaks
- [ ] Captures, `ui-reviewer`, `security-reviewer`, `/code-review`
- [ ] Vérifier : CI verte, récapitulatif, STOP
