# Benchmark OCR des tickets (spike Sprint 3)

Mesures du 16/11/2026 sur la branche `sprint/3-ocr-spike`. Objet : trancher ADR-008 (moteur OCR exécuté dans le navigateur, gratuit, CPU). Tous les chiffres ci-dessous ont été mesurés avec les commandes de la section « Reproduire » ; rien n'est extrapolé.

## En bref

- **Par défaut : tesseract.js 7 (`fra+eng`)**. Sur le jeu synthétique : CER moyen 0,3 %, total et date retrouvés sur 16/16 images, 1,15 s par image en moyenne en Node et 0,92 s dans Chromium (texte identique), environ 5 Mo à télécharger.
- **Repli : PaddleOCR PP-OCRv6 small via `ppu-paddle-ocr`** (onnxruntime-web dans le navigateur), chargé à la demande seulement quand tesseract ou le parseur échouent. CER 0,7 % avec redressement, mais 7,3 s par image en Node (5,1 s dans Chromium) et 31,3 Mo de modèles.
- **Redressement obligatoire avant Paddle** : sans lui, le CER de Paddle sur les trois photos inclinées de 2,5 à 4° est de 18 à 36 % (lignes libellé/prix séparées). Avec le redressement par profil de projection (`scripts/ocr/normalise.ts`), il redescend à 0-3 % pour v5-latin et v6-small (6-8 % pour v6-tiny).
- **PDF à couche texte : pas d'OCR**. `pdfjs-dist` lit le texte (CER 2,7 %, uniquement de l'ordre des cellules).
- Limite majeure : le jeu est **synthétique** (police Courier New nette, dégradations simulées). L'avantage de tesseract y est probablement surestimé ; la décision finale sur le repli doit être confirmée sur les vrais tickets (dernière section).

## Méthode

### Jeu de données

18 fixtures synthétiques (ADR-030) dans `fixtures/receipts/`, générées par `scripts/fixtures/generate-receipts.ts` à partir des mêmes données que `expected.json` et `truth.txt` (texte exact rendu) :

- 16 tickets thermiques en image : supermarchés x6 (dont un ticket long de 29 articles), boulangerie, restaurant (TVA 10 %), carburant (litres x prix/L), pharmacie (TVA 2,1 %), bricolage avec garantie, vêtements avec délai de retour, tabac-presse, café, épicerie riche en accents (é è à ç ù ê ï ô û œ), ticket délavé, photo inclinée sur fond de table ;
- dégradations sharp : rotation de -4° à +4°, flou (sigma 0,6 à 1,3), bruit, contraste faible (délavé), rognage ;
- formats variés : dates `jj/mm/aaaa`, `jj/mm/aa`, `jj.mm.aaaa` ; heures `18:42` et `18h42` ; totaux « TOTAL TTC », « TOTAL », « A PAYER », « NET A PAYER », « MONTANT TTC » ; paiements CB et espèces ;
- 2 factures e-commerce PDF avec couche texte (`page.pdf` de Chromium).

### Chaîne mesurée (identique pour chaque moteur)

1. **Normalisation** (`scripts/ocr/normalise.ts`, sharp) : orientation EXIF, niveaux de gris, grand côté ≤ 2000 px (comme ADR-027), puis redressement : recherche de l'angle de -6° à +6° (pas de 0,25°) qui maximise la netteté du profil de projection horizontal, mesurée sur le centre de l'image. Algorithme volontairement simple, transposable en canvas dans le navigateur.
2. **OCR** sur la même image PNG normalisée.
3. **Parseur déterministe** `parseReceiptText` (`src/lib/domain/receipts/parse.ts`) : importé dynamiquement s'il existe. **Il n'existait pas dans cette branche au moment des mesures** : les colonnes « parseur » (exactitude par champ, nombre d'articles, F1 des articles, borne haute sur `truth.txt`) s'afficheront automatiquement à la prochaine exécution.

### Métriques

- **Temps** : moyenne et p95 par image, OCR seul (hors normalisation et hors initialisation), après une passe d'échauffement non comptée. Initialisation rapportée à part.
- **CER** (taux d'erreur caractère) : distance de Levenshtein / longueur de `truth.txt`, après réduction des espaces multiples, suppression des lignes vides et des lignes décoratives (`-----`). Les colonnes ne sont donc pas comparées, l'ordre des lignes oui. « CER sans accents » : même calcul après suppression des diacritiques des deux côtés.
- **Total / date retrouvés** : la chaîne imprimée (`22,67`, `27/06/2026`) apparaît dans le texte OCR sans chiffre collé avant ou après (`20,333` ne valide pas `20,33`).
- **Enseigne** : `merchantRaw` présent tel quel (« exacte ») ou après normalisation (majuscules, sans accents ni ponctuation).
- **Erreurs d'accent** : substitutions ou suppressions d'une lettre accentuée par une variante de la même lettre, comptées sur l'alignement Levenshtein.
- **Taille des modèles** : octets sur disque après téléchargement (cache local), et taille transférée mesurée avec `curl -I` (section dédiée).

## Environnement

- Windows 11 Home (10.0.26300), Intel Core i5-12450H (12 threads), 16 Go, CPU uniquement.
- Node v22.15.0, pnpm 10.28.2. Versions vérifiées sur le registre npm le 16/11/2026, installées en devDependencies :

| Paquet           | Version | Rôle                                                     |
| ---------------- | ------- | -------------------------------------------------------- |
| tesseract.js     | 7.0.0   | OCR Tesseract LSTM en WebAssembly (Node et navigateur)   |
| ppu-paddle-ocr   | 6.7.1   | PaddleOCR PP-OCRv5/v6 en ONNX (Node, navigateur, worker) |
| onnxruntime-node | 1.31.1  | moteur ONNX pour le banc Node                            |
| onnxruntime-web  | 1.31.1  | moteur ONNX WASM/WebGPU pour le navigateur               |
| pdfjs-dist       | 6.5.438 | extraction de la couche texte des PDF                    |
| sharp            | 0.35.5  | normalisation, redressement, dégradations des fixtures   |

- Modèles : tesseract `fra` + `eng` (`4.0.0_best_int`, LSTM seul, CDN jsDelivr) ; Paddle `v6-tiny`, `v6-small` (multilingues, format `.ort`) et `v5-latin` mobile (`.onnx`), servis par Hugging Face (`snowfluke/ppu-paddle-ocr-models`).

## Résultats (16 images, chaîne par défaut avec redressement)

| Moteur              | Temps moyen | p95       | Init     | CER   | CER sans accents | Total | Date   | Enseigne exacte | Enseigne normalisée | Erreurs d'accent | Modèles sur disque |
| ------------------- | ----------- | --------- | -------- | ----- | ---------------- | ----- | ------ | --------------- | ------------------- | ---------------- | ------------------ |
| tesseract (fra+eng) | 1 153 ms    | 2 834 ms  | 1 052 ms | 0,3 % | 0,3 %            | 100 % | 100 %  | 93,8 %          | 100 %               | 4                | 6,4 Mo             |
| paddle v6-tiny      | 3 252 ms    | 4 913 ms  | 2 463 ms | 4,1 % | 4,1 %            | 100 % | 62,5 % | 75,0 %          | 100 %               | 2                | 6,4 Mo             |
| paddle v5-latin     | 9 018 ms    | 15 677 ms | 1 406 ms | 1,9 % | 1,9 %            | 100 % | 93,8 % | 81,3 %          | 93,8 %              | 3                | 12,8 Mo            |
| paddle v6-small     | 7 343 ms    | 11 993 ms | 438 ms   | 0,7 % | 0,7 %            | 100 % | 75,0 % | 87,5 %          | 100 %               | 1                | 31,3 Mo            |

PDF (2 factures, pas d'OCR) : `pdfjs-dist` en 1 428 ms en moyenne (premier appel inclus, chargement du module), CER 2,7 %, total, date et enseigne retrouvés 2/2.

Normalisation avec redressement : 603 ms en moyenne par image, p95 1 210 ms (Node, sharp). Les 5 images tournées ont été redressées de -3,25°, -1,25°, +1,5°, -2,5° et +4°, soit l'opposé de l'angle appliqué par le générateur à 0,05° près ; aucune des 11 images droites n'a été tournée.

Variabilité : sur cinq exécutions complètes de la journée, le temps moyen de tesseract a varié de 924 à 1 153 ms (machine partagée avec d'autres processus) ; les écarts entre moteurs restent du même ordre.

### Effet du redressement

Même jeu, `pnpm ocr:bench --no-deskew --no-write` (normalisation sans redressement : 47 ms en moyenne, p95 119 ms) :

| Moteur          | CER sans / avec redressement | Total sans redressement | Date sans redressement | Enseigne normalisée sans redressement | Temps moyen sans redressement |
| --------------- | ---------------------------- | ----------------------- | ---------------------- | ------------------------------------- | ----------------------------- |
| tesseract       | 0,5 % / 0,3 %                | 100 %                   | 100 %                  | 93,8 %                                | 1 022 ms                      |
| paddle v6-tiny  | 8,2 % / 4,1 %                | 100 %                   | 68,8 %                 | 93,8 %                                | 3 311 ms                      |
| paddle v5-latin | 7,7 % / 1,9 %                | 93,8 %                  | 100 %                  | 81,3 %                                | 12 190 ms                     |
| paddle v6-small | 5,4 % / 0,7 %                | 100 %                   | 75,0 %                 | 100 %                                 | 7 297 ms                      |

CER par photo inclinée sans redressement (tesseract / v6-tiny / v5-latin / v6-small) : Lidl 2,5° 1,8 / 21,9 / 25,7 / 18,4 % ; Monoprix 4° 1,7 / 35,8 / 29,3 / 30,3 % ; Auchan 3,2° 0,0 / 29,0 / 34,5 / 25,4 %. Les images droites ne changent pas (aucun angle détecté). Le temps de v5-latin varie fortement d'une exécution à l'autre (9,0 s puis 12,2 s de moyenne).

### Navigateur

`pnpm ocr:bench:browser` envoie les mêmes 16 images normalisées (avec redressement) à Chromium headless (Playwright), via les builds navigateur : `tesseract.js` (worker et cœur WASM depuis jsDelivr) et `ppu-paddle-ocr/web` + `onnxruntime-web` 1.31.1 en WASM seul (pas de WebGPU), page isolée cross-origin (COOP/COEP), 4 threads WASM. Même passe d'échauffement non comptée. Le texte obtenu est comparé à `ocr.tesseract.txt` et `ocr.paddle.txt` du banc Node, après réduction des espaces et suppression des lignes vides.

| Moteur          | Init (téléchargement compris, cache vide) | Temps moyen | p95       | Textes identiques au banc Node | Écart de caractères |
| --------------- | ----------------------------------------- | ----------- | --------- | ------------------------------ | ------------------- |
| tesseract       | 3 923 ms                                  | 922 ms      | 2 484 ms  | 16/16                          | 0,00 %              |
| paddle v6-small | 27 432 ms                                 | 5 092 ms    | 10 345 ms | 7/16                           | 0,40 %              |

Conclusion : les résultats Node sont représentatifs du navigateur. Tesseract donne le même texte sur les 16 images. Paddle diffère légèrement (0,40 % des caractères ; cause non investiguée, le décodage d'image et le prétraitement passent par canvas dans le navigateur et par un autre chemin en Node) et s'exécute même plus vite qu'en Node sur cette machine. En production, la normalisation et le redressement devront être réimplémentés en canvas (ici ils sont faits par sharp avant l'envoi au navigateur). L'initialisation navigateur de Paddle (27 s) inclut le téléchargement des 31 Mo de modèles depuis Hugging Face (part non mesurée séparément).

## Tailles à télécharger (navigateur)

Mesurées le 16/11/2026 (`curl -I`, en-têtes `Content-Length`, compression demandée) :

| Élément                                       | Transfert                              | Sur disque |
| --------------------------------------------- | -------------------------------------- | ---------- |
| tesseract.js worker (`worker.min.js`)         | 0,03 Mo (brotli)                       | -          |
| tesseract.js-core `simd-lstm.wasm.js`         | 1,37 Mo (brotli)                       | 3,90 Mo    |
| `fra.traineddata.gz` (best_int)               | 0,71 Mo                                | 1,25 Mo    |
| `eng.traineddata.gz` (best_int)               | 2,95 Mo                                | 5,20 Mo    |
| **Total tesseract fra+eng**                   | **≈ 5,1 Mo**                           |            |
| onnxruntime-web `ort-wasm-simd-threaded.wasm` | 3,20 Mo (brotli)                       | 14,8 Mo    |
| PP-OCRv6 tiny (det + rec + dict)              | 6,4 Mo (Hugging Face ne compresse pas) | 6,4 Mo     |
| PP-OCRv5 latin mobile (det + rec + dict)      | 12,8 Mo                                | 12,8 Mo    |
| PP-OCRv6 small (det + rec + dict)             | 31,3 Mo                                | 31,3 Mo    |
| **Total repli Paddle v6-small**               | **≈ 34,5 Mo** (avec le WASM ORT)       |            |

Compressés en gzip, les modèles v6-small ne descendent qu'à 26,1 Mo (det 7,6 Mo + rec 18,5 Mo) : le gain d'un auto-hébergement compressé est faible. La bibliothèque `ppu-paddle-ocr/web` elle-même pèse 48 Ko (plus `ppu-ocv`, 371 Ko non minifiés).

## Échecs par catégorie

- **Photo inclinée / rotation (Paddle)** : sans redressement, Paddle regroupe mal les lignes d'un ticket incliné de 2,5 à 4° (libellé et prix sur des lignes différentes, colonnes de TVA mélangées). C'est la principale cause d'erreur de Paddle ; le redressement la corrige presque entièrement. Tesseract y est peu sensible (1,7 à 1,8 % de CER sans redressement sur ces photos, 0,2 à 0,5 % avec).
- **Espaces supprimés (PP-OCRv6)** : v6-tiny et v6-small collent souvent la date et l'heure (`09/11/202608:05`, `03.04.202618h09`) : d'où 62,5 % et 75 % de dates retrouvées alors que les chiffres sont justes. Le parseur doit accepter `jj/mm/aaaaHH:MM` sans séparateur. Même phénomène sur d'autres espaces (`AUCHANSUPERMARCHE 0915`, `TOTALREMISES` chez v6-small ; `NBARTICLES`, `MOZZARELLA125G` chez v5-latin sans redressement) : l'enseigne doit être cherchée sans espaces, comme le fait la métrique « enseigne normalisée ».
- **Chiffres parasites (Paddle sans redressement)** : `20,333 EUR` pour `20,33 EUR`, `22 ,67` : la validation déterministe (somme des articles, TVA) doit rester le garde-fou (règle 6).
- **Lettres de TVA** : sans redressement, tesseract a lu la lettre de taux `A` en `a` ou `à` en fin de ligne d'article (photo Lidl) ; Paddle colle la lettre au prix (`4,50A`).
- **Confusions de caractères** : `75c1` pour `75cl` (tesseract, épicerie) ; `TIE` pour `TTC` dans l'en-tête du tableau de TVA du ticket délavé (tesseract).
- **Enseigne** : l'en-tête en gros caractères accentué `ÉPICERIE FINE DES PRÉS` perd ses accents (tesseract, v5-latin) ; `LIDIL 1842` pour `LIDL 1842` (tesseract sans redressement) ; v5-latin rate l'en-tête de la boulangerie.
- **Flou et contraste faible** : tesseract reste sous 1 % ; v6-tiny est le plus sensible (7,2 % sur les images floues).
- **Carburant** : v6-tiny et v5-latin à 8,1 % (ligne `38,52 L x 1,790 EUR/L` mal découpée), v6-small 1,2 %, tesseract 0,3 %.
- **PDF** : les seules erreurs viennent de l'ordre des cellules (un montant HT d'une cellule à deux lignes reconstitué sur la ligne suivante). Aucune erreur de caractère.

## Accents

Le jeu contient peu d'accents hors du ticket d'épicerie (les caisses impriment souvent sans accents) : sur l'ensemble, les accents pèsent au plus 0,1 point de CER, quel que soit le moteur (colonne « CER sans accents »). Confusions observées (chaîne par défaut) :

- tesseract : `É -> E` x2 (en-tête en gros caractères), `ù -> u` x1, `ê -> é` x1 (`fétes`) ; sans redressement, aussi la lettre de TVA `A -> à`.
- paddle v6-tiny : `ï -> i` x1, `û -> ü` x1 (`BRÜLÉE`).
- paddle v5-latin : `É -> E` x2, `ï -> i` x1.
- paddle v6-small : `ï -> i` x1.
- Non compté comme erreur d'accent (ligature) : `Œufs` lu `Eufs` par Paddle (v5-latin et v6-small).

Post-traitements proposés (dans le parseur, pas dans le moteur) :

1. **Comparer sans accents** : tous les mots-clés (`TOTAL`, `A PAYER`, `ESPECES`, `PAYE`, `RENDU`, `REMISE`, `TVA`, `Retour sous N jours`, `Garantie N ans`) et les enseignes du catalogue sont comparés après `normalize("NFD")` + suppression des diacritiques, en majuscules (déjà le principe de `src/lib/domain/merchant.ts`). L'accent n'a alors plus d'effet sur l'extraction.
2. **Restaurer l'orthographe par dictionnaire** : pour l'affichage, remplacer l'enseigne reconnue par son nom canonique du catalogue (`INTERMARCHE` -> « Intermarché ») ; pour les libellés d'articles, garder le texte OCR tel quel (l'utilisateur valide).
3. **Normaliser les variantes improbables en français** : `ü` hors `ü` légitime (`ï`/`ü` rares) -> `û` quand le mot sans accent est connu (`BRULEE`), `Œ` perdu -> `OE`. À faire seulement avec un lexique, jamais à l'aveugle.
4. **Champs numériques** : retirer les espaces autour de la virgule (`22 ,67`), accepter `.` ou `,` comme séparateur décimal, et ignorer une lettre de TVA isolée (`A`, `a`, `à`, `B`, `C`) en fin de ligne d'article.
5. **Unicode** : normaliser la sortie en NFC (Paddle et tesseract peuvent produire des formes décomposées selon le dictionnaire).

## Moteurs écartés ou non retenus

- **`@gutenye/ocr-node` / `@gutenye/ocr-browser` 1.4.9** : non mesurés. Le paquet de modèles (`@gutenye/ocr-models` 1.4.2, publié en mai 2024) fournit PP-OCRv4 chinois avec le dictionnaire `ppocr_keys_v1`, sans modèle latin ; la version Node impose `sharp ^0.34` et `onnxruntime-node ^1.22` en doublon. `ppu-paddle-ocr` couvre le même besoin avec des modèles latins et v6 maintenus.
- **`onnxruntime-web` + modèles PP-OCRv5 « à la main »** : non nécessaire, `ppu-paddle-ocr/web` utilise exactement onnxruntime-web avec les mêmes modèles et gère le pré/post-traitement (détection DB, découpe, décodage CTC).
- **Paddle v5-latin** : précis (1,9 %) mais le plus lent (9,0 à 12,2 s par image en Node selon l'exécution ; modèles `.onnx` là où v6 utilise `.ort`, cause non investiguée) pour 12,8 Mo ; dominé par v6-small en précision et par v6-tiny en taille.
- **Paddle v6-tiny** : petit (6,4 Mo) mais le moins précis (4,1 %, 62,5 % de dates à cause des espaces perdus).
- Aucune installation n'a échoué sous Windows : `onnxruntime-node` fonctionne sans exécuter ses scripts d'installation (pnpm les ignore ; les binaires Windows x64 sont inclus dans le paquet).

## Recommandation (ADR-008)

ADR-008 proposait Paddle en principal et tesseract en repli. **Les mesures inversent l'ordre**, au moins pour la livraison du Sprint 3 :

1. **Défaut : tesseract.js 7, `fra+eng`, dans un Web Worker**, après normalisation et redressement côté navigateur (canvas). Meilleur CER mesuré, plus rapide, ≈ 5 Mo téléchargés une fois puis mis en cache (IndexedDB par tesseract.js).
2. **Repli : `ppu-paddle-ocr/web` avec PP-OCRv6 small** (onnxruntime-web, WASM, WebGPU si disponible), chargé à la demande seulement quand le parseur ne trouve pas de total cohérent avec les articles ou la TVA. ≈ 34,5 Mo au premier usage : avertir l'utilisateur, mettre en cache (Cache API ou service worker).
3. **PDF** : extraire la couche texte avec `pdfjs-dist` ; OCR seulement si le PDF n'a pas de texte (scan).
4. Dans tous les cas, la sortie passe par Zod, la validation déterministe puis la revue humaine (règle 6).

À reconsidérer après le passage sur les vrais tickets : si Paddle v6-small y bat nettement tesseract (photos réelles, papier froissé, éclairage inégal), inverser défaut et repli ; si v6-tiny y fait jeu égal, le préférer en repli pour son poids.

## Reproduire

```
pnpm install
pnpm fixtures:receipts            # régénère fixtures/receipts (Playwright Chromium + sharp)
pnpm test src/lib/domain/receipts # cohérence des expected.json (somme, TVA, dates)
pnpm ocr:bench                    # chaîne par défaut (avec redressement), écrit ocr.tesseract.txt, ocr.paddle.txt (v6-small), ocr.pdf-text.txt
pnpm ocr:bench --no-deskew --no-write                  # comparaison sans redressement
pnpm ocr:bench --engines tesseract,paddle-v6-small     # sous-ensemble de moteurs
pnpm ocr:bench --only lidl-2026-09-01 --print --no-write   # texte brut (fixtures publiques uniquement)
pnpm ocr:bench:browser            # mêmes images dans Chromium headless (WASM), comparées aux sorties Node
```

Le premier lancement télécharge les modèles (cache `~/.cache/tesseract.js` et `~/.cache/ppu-paddle-ocr`). Le benchmark ne fait pas partie de `pnpm test`. Les sorties `ocr.*.txt` commitées permettent de tester le parseur sans OCR.

## Tickets réels : à exécuter quand `fixtures/receipts-private/` est rempli

Les vrais tickets restent dans `fixtures/receipts-private/<id>/` (ignoré par git), même structure : `source.jpg|png|webp|pdf` + `expected.json` saisi à la main (skill `mywallet-receipt-fixtures`). `truth.txt` est facultatif : sans lui, pas de CER ni d'erreurs d'accent ; la date est alors cherchée sous les formats `jj/mm/aaaa`, `jj/mm/aa`, `jj.mm.aaaa` et `jj-mm-aaaa` dérivés de `expected.date`.

```
pnpm ocr:bench --dir fixtures/receipts-private
```

Garanties de confidentialité du script dans ce mode : aucun identifiant, texte ni valeur n'est affiché ; seuls les agrégats sont imprimés et écrits dans `fixtures/receipts-private/benchmark-summary.json` ; les sorties brutes `ocr.*.txt` sont écrites uniquement dans le dossier privé ; `--print` est ignoré ; `--json` refuse un chemin hors du dossier privé. Le dossier absent ou vide est signalé sans erreur.

Seuls les agrégats pourront être recopiés ici, dans une section « Résultats sur tickets réels » (nombre de tickets, temps moyen et p95, taux de total, date et enseigne retrouvés, exactitude du parseur par champ), pour confirmer ou inverser la recommandation.
