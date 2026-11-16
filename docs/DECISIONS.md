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

## ADR-013 — Énumérations en `text` + CHECK

- Décision : statuts et types stockés en `text` avec contrainte CHECK (pas de `pgEnum`), listes partagées en TypeScript.
- Conséquences : ajouter une valeur = une migration qui remplace la contrainte, sans `ALTER TYPE`.

## ADR-014 — Clés étrangères composites optionnelles en NO ACTION

- Contexte : Drizzle ne sait pas exprimer `ON DELETE SET NULL (col)` ; un `SET NULL` simple annulerait aussi `user_id`.
- Décision : NO ACTION. La couche domaine détache ou réaffecte les lignes avant de supprimer une catégorie, un marchand, une règle ou une transaction liée. La suppression d'un utilisateur cascade toujours (contrôle en fin d'instruction).

## ADR-015 — Marchands par utilisateur

- Décision : table `merchants` par utilisateur (alias, domaine, logo, catégorie par défaut), alimentée depuis un catalogue d'enseignes françaises (seed, puis à l'inscription au Sprint 1).

## ADR-016 — Créances : `claims` + `claim_payments`

- Décision : une créance par part et par personne ; chaque remboursement reçu crée une transaction `reimbursement` (> 0, sur n'importe quel compte) et une ligne `claim_payments`. La clé étrangère `(user_id, transaction_id, transaction_kind='reimbursement')` garantit qu'un paiement ne pointe que vers un remboursement. Supprimer la transaction de remboursement supprime le paiement (cascade) ; une créance ou une dépense ayant des paiements ne peut pas être supprimée.
- Règles applicatives (Sprint 4, `src/lib/domain`) : somme des paiements ≤ montant dû, statut `reimbursed` seulement si soldée, devise identique, retour à `pending` après annulation d'un paiement.
- Ma dépense réelle = |dépense| − Σ parts (en attente ou remboursées : montant ; offertes : seulement la part déjà payée ; annulées : 0).

## ADR-017 — Convention de signe

- Décision : `transactions.amount_cents` signé (négatif = sortie, positif = entrée). CHECK : dépense < 0, revenu et remboursement > 0, virement ≠ 0. Les lignes de ticket stockent des montants positifs (remises négatives).
- Point ouvert : le remboursement d'un achat par un marchand (avoir) devra être modélisé au Sprint 1 (nouveau type ou assouplissement du CHECK).

## ADR-018 — PostgreSQL local sur le port 5433

- Contexte : un PostgreSQL natif Windows occupe déjà 5432 sur le poste de développement.
- Décision : le conteneur `db` est publié sur 5433 côté hôte. La CI garde 5432 (service isolé).

## ADR-019 — `jobs.user_id` facultatif

- Décision : nullable pour permettre des tâches système ; cascade depuis `user` quand renseigné.

## ADR-020 — Avoir marchand : type `refund`

- Contexte : point ouvert de l'ADR-017 (remboursement d'un achat par un marchand). Validé par l'utilisateur au Sprint 1.
- Décision : nouveau type de transaction `refund`, montant > 0. Il recrédite le solde, n'est pas un revenu et vient en déduction de la dépense de sa catégorie et de son marchand. Pas de lien obligatoire vers l'achat d'origine.

## ADR-021 — Suppression d'une catégorie : remplacement obligatoire

- Décision (validée) : supprimer une catégorie utilisée exige une catégorie de remplacement de même nature. Transactions, lignes de ticket, marchands, règles récurrentes et règles de catégorisation sont réaffectés dans la même transaction SQL. Les budgets de la catégorie supprimée sont supprimés (ils n'ont pas de sens sur une autre catégorie). Une catégorie qui a des sous-catégories ne peut pas être supprimée tant qu'elles existent.
- Profondeur maximale : 2 niveaux (catégorie, sous-catégorie) ; une sous-catégorie a la même nature que son parent.

## ADR-022 — Logos des marchands sans compte tiers

- Décision (validée) : chaîne de résolution (1) logo importé par l'utilisateur, (2) icône de marque `simple-icons` (CC0) embarquée pour le catalogue d'enseignes, rendue en SVG monochrome, (3) favicon du domaine via Google S2 puis DuckDuckGo Icons, (4) monogramme. Logo.dev reste une option future (clé gratuite + attribution).
- Sécurité : le serveur ne contacte que ces deux hôtes fixes (le domaine n'est qu'un paramètre), domaine validé, réponse limitée en taille et en type (PNG, ICO, JPEG, GIF, WebP ; jamais de SVG distant), délai court. La route `/api/merchants/[id]/logo` exige une session et un marchand de l'utilisateur : impossible de s'en servir comme proxy.
- Cache durable en base (`logo_cache`, clé = domaine, sans donnée utilisateur, partagé entre utilisateurs) : un favicon trouvé est gardé 30 jours, une absence 7 jours. Rien n'est stocké sur disque (incompatible avec Vercel).
- Logo importé : stocké en `bytea` sur le marchand (256 Kio max, PNG/JPEG/WebP vérifiés par signature), servi avec `Content-Security-Policy: default-src 'none'`.

## ADR-023 — Provisionnement à l'inscription

- Décision : à la création d'un utilisateur (hook Better Auth `databaseHooks.user.create.after`), insertion des catégories par défaut, du catalogue d'enseignes françaises et d'un compte courant. Catalogue partagé avec le seed dans `src/lib/catalog/`.

## ADR-024 — Échéances récurrentes : prévues puis validées

- Décision (validée au Sprint 2) : une règle récurrente génère des **échéances** (`recurring_occurrences`) au statut `planned`. Une échéance prévue apparaît au calendrier et compte dans le reste à vivre, jamais dans un solde. La valider crée la vraie transaction (montant, date et compte ajustables) et la relie (`confirmed`) ; l'ignorer la passe en `skipped`. Supprimer la transaction ou annuler la validation la remet en `planned`.
- Idempotence : curseur `next_run_on` sur la règle (lignes verrouillées `FOR UPDATE`) et contrainte unique `(user_id, rule_id, due_on)` avec `ON CONFLICT DO NOTHING`. Génération paresseuse à l'affichage (tableau de bord, Récurrent), jusqu'à la fin du mois affiché, au plus 12 mois à l'avance ; aucune tâche planifiée nécessaire.
- Première échéance : la première date à partir d'aujourd'hui. Les dates passées ne sont pas générées (elles ont le plus souvent déjà été saisies à la main ; les générer les compterait deux fois).
- Modifier une règle régénère ses échéances prévues à venir ; les échéances encore prévues en retard prennent le nouveau montant (et le nouveau signe) ; les échéances validées ou ignorées sont conservées et leur période (mois, année) ne reçoit pas de seconde échéance avec le nouveau calendrier. Supprimer une règle supprime ses échéances, les transactions déjà validées restent (lien vers la règle retiré).
- Dates : jours 29 à 31 ramenés au dernier jour des mois courts, 29 février annuel ramené au 28 les années non bissextiles, pas de report au jour ouvré.

## ADR-025 — Reste à vivre

- Décision (validée) : reste à vivre = solde des comptes courants et espèces (hors épargne, carte de crédit et autres, hors comptes archivés) + effet des échéances du mois encore prévues (charges et épargne en moins, revenus en plus, échéances en retard comprises). Utilisable aujourd'hui = reste à vivre ÷ jours restants (aujourd'hui inclus), arrondi au centime inférieur, jamais négatif.
- Un virement prévu ne compte que pour la part qui touche un compte disponible (épargne : en moins ; entre deux comptes disponibles : neutre).

## ADR-026 — Épargne récurrente = virement

- Décision (validée) : une règle `transfer` (« Épargne ») porte un compte débité (`account_id`) et un compte crédité (`to_account_id`, migration additive 0002). Validée, elle crée un virement (deux jambes) : pas une dépense, le patrimoine total ne change pas, le reste à vivre baisse.
- Les jambes d'un virement sont désormais mises à jour sur place lors d'une modification (identifiants stables : l'échéance pointe sur la jambe débitrice).

## ADR-027 — Fichiers de tickets stockés dans PostgreSQL

- Contexte : Vercel Hobby n'a pas de disque persistant ; Vercel Blob gratuit bloque le stockage 30 jours en cas de dépassement. Neon Free offre 1 Go par projet.
- Décision (validée au Sprint 3) : les fichiers sont stockés dans une table dédiée (`receipt_files`, `bytea`, filtrée par `user_id`) derrière l'interface `StorageAdapter` (`put`, `get`, `delete`). Les photos sont normalisées et compressées dans le navigateur (JPEG, grand côté ≤ 2000 px, ~200 Ko) avant envoi ; une miniature est stockée à part. Les PDF sont gardés tels quels (taille maximale 8 Mo).
- Conséquences : environ 3 000 à 4 000 tickets tiennent dans le quota. Aucun nouveau service, isolation par la même règle que le reste. Un autre adaptateur (S3 compatible, disque en auto-hébergement) pourra remplacer celui-ci sans changer l'appelant.

## ADR-028 — Rapprochement relevé bancaire et transactions

- Décision (validée) : à l'import d'un relevé CSV, une ligne qui correspond à une transaction existante non rapprochée (même compte, montant exact, date à ±3 jours) est **liée** à cette transaction (elle devient « pointée »), rien n'est créé. Les lignes sans correspondance sont créées après aperçu et confirmation. Une ligne déjà importée (même empreinte date + montant + libellé normalisé + compte) est ignorée.
- Un ticket validé plus tard est rapproché d'une ligne bancaire déjà importée de la même façon : il s'attache à la transaction existante au lieu d'en créer une seconde.
- Conséquences : colonnes `bank_line_hash` et `reconciled_at` sur `transactions` ; préréglages de colonnes par utilisateur (`bank_import_presets`).

## ADR-029 — Structuration des tickets : règles, Ollama, Gemini

- Décision (validée) : interface `ReceiptStructurer` avec trois adaptateurs. `rules` (défaut) = parseur déterministe. `ollama` = modèle de vision local (Qwen-VL), sortie JSON contrainte par schéma, disponible seulement si `OLLAMA_URL` est configuré (local ou Docker). `gemini-free` = désactivé par défaut, activable par l'utilisateur dans Réglages après un avertissement (l'offre gratuite est limitée et Google peut utiliser les contenus), clé API fournie par l'utilisateur côté serveur.
- Un modèle n'est appelé que si le parseur échoue ou si la confiance est faible. Sa sortie repasse par la validation Zod et la validation déterministe, puis par la revue humaine (règle 6).

## ADR-030 — Fixtures publiques synthétiques

- Décision (validée) : les fixtures commitées (`fixtures/receipts/`) sont des tickets français synthétiques réalistes rendus en images (bruit, rotation, papier thermique) et en PDF. Les vrais tickets de l'utilisateur restent dans `fixtures/receipts-private/` (ignoré par git) et ne servent qu'au benchmark local, dont seuls les agrégats sont publiés.

## ADR-031 — Content Security Policy sans nonce

- Contexte : une CSP à nonce oblige à rendre chaque page à la requête ; la doc Next 16 la déclare incompatible avec le prérendu partiel (Cache Components, ADR-007).
- Décision : CSP fixe dans `next.config.ts` : tout limité à l'origine (`default-src`, `connect-src`, `img-src`, `worker-src` avec `blob:`), `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`. `script-src` garde `'unsafe-inline'` (charge RSC en scripts en ligne) et ajoute `'wasm-unsafe-eval'` pour l'OCR WebAssembly, sans `eval()` JavaScript en production.
- Conséquences : l'exfiltration vers un domaine tiers est bloquée (`connect-src`), mais un script injecté en ligne ne le serait pas : l'échappement React et l'absence de `dangerouslySetInnerHTML` restent la première défense. Les modèles OCR sont servis depuis l'origine (aucun CDN tiers).
