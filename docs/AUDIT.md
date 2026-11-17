# Audit d'accessibilité et de performance (Sprint 8)

Mesures du 17 novembre 2026 sur le build de production (`pnpm build && pnpm start`), base locale, données de démonstration.

## Accessibilité

- **axe-core** (via `@axe-core/playwright`, intégré aux tests e2e, bureau et mobile) sur le tableau de bord, Transactions, Budgets, Analyses, Personnes et Réglages : **aucune violation grave ou critique**. Le test échoue en CI dès qu'une violation de ce niveau apparaît.
- Clavier : palette ⌘K / Ctrl+K (pages, actions, recherche de mouvements, magasins, personnes, catégories), `N` nouvelle transaction, `H` masquer les montants, Échap ferme les fenêtres ; focus visible (anneau accent) sur tous les éléments.
- Cibles tactiles de 44 px sur écran tactile (`pointer-coarse:`), libellés en français sur les boutons-icônes, graphiques doublés d'un tableau.
- Contraste AA : `text-subtle` réservé au décoratif ou désactivé (charte).
- Mouvement réduit respecté (`prefers-reduced-motion`).

## Performance

Profil mobile (390 px, écran ×2), processeur ralenti ×4, réseau local non bridé, script `perf-audit` (Playwright, `PerformanceObserver`) :

| Page                                   | TTFB   | LCP    | CLS   | JS transféré |
| -------------------------------------- | ------ | ------ | ----- | ------------ |
| / (première page, toute l'application) | 27 ms  | 788 ms | 0,000 | 197 Ko       |
| /transactions                          | 9 ms   | 604 ms | 0,000 | 15 Ko        |
| /tickets                               | 106 ms | 400 ms | 0,000 | 34 Ko        |
| /budgets                               | 10 ms  | 180 ms | 0,000 | 56 Ko        |
| /analyses                              | 122 ms | 492 ms | 0,000 | 56 Ko        |
| /personnes                             | 11 ms  | 408 ms | 0,000 | 15 Ko        |

- LCP sous 2,5 s et CLS nul partout : la coquille est prérendue (Cache Components) et les données arrivent en streaming sous `<Suspense>`.
- Après la première page, une navigation ne charge que quelques dizaines de Ko de JavaScript.
- Le moteur OCR (environ 5 Mo) n'est téléchargé qu'à la lecture d'un ticket.
- En production, ajouter la latence vers Neon (Francfort) et le démarrage à froid des fonctions Vercel : quelques centaines de millisecondes sur la première requête.

## Dépendances

`pnpm audit` : un avis modéré restant, `minimatch` dans l'outillage de lint (non embarqué dans l'application). `esbuild` (outil de migration) est forcé en version corrigée, `fflate` est en 0.8.3.
