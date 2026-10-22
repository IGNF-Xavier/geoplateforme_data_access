# Accès aux données géographiques – Géoplateforme

> ⚠️ **Projet expérimental et non officiel.** Application personnelle, indépendante de l'IGN, construite sur les services publics de la [Géoplateforme](https://geoservices.ign.fr/). Aucune garantie de disponibilité, d'exactitude ni de pérennité ; l'interface et les comportements peuvent changer sans préavis.

**Démo : <https://ignf-xavier.github.io/geoplateforme_data_access/>**

Portail web qui part du besoin (« je veux **cette donnée** ») et non de l'organisation technique des données :

```
RECHERCHER (par besoin ou par nom) → FICHE → utiliser · télécharger · extraire
                                       └─ ZONE facultative, définie sur place
```

- **Recherche par besoin** : on peut taper « bâtiments », « altitude », « photos aériennes », « je cherche les rivières » ou même « batiements » sans connaître BD TOPO, BD ALTI ou BD ORTHO. Un thésaurus de besoins, les thèmes INSPIRE du catalogue et une recherche floue classent les données les plus adaptées en tête, avec la raison affichée. La recherche couvre le catalogue GeoNetwork **et** l'index de recherche de la Géoplateforme (couches absentes du catalogue, par exemple Patrinat/MNHN, et offres à accès restreint, signalées). Une recherche sémantique locale, facultative, la complète.
- **Pas d'étape « zone » obligatoire** : un géoservice (WMS, WMTS, WFS, TMS) s'utilise immédiatement. La zone est un outil facultatif de la fiche, utile pour vérifier qu'un service couvre un secteur, ou pour télécharger / extraire.
- **Trois modes** : *Utiliser dans un SIG* (fichier QGIS natif, URL de service), *Télécharger* (fichiers par territoire), *Extraire* (découpe à la zone, compte Géoplateforme requis).
- **Contact du producteur** : adresse courriel, quand les métadonnées la publient (utile pour demander l'accès à une donnée restreinte).

Interface : [DSFR](https://www.systeme-de-design.gouv.fr/) ; carte OpenLayers avec [geopf-extensions-openlayers](https://github.com/IGNF/geopf-extensions-openlayers).

## Installation et développement

Prérequis : Node.js 20 ou plus.

```bash
npm install --legacy-peer-deps   # le résolveur npm échoue sinon sur l'arbre actuel (aucun vrai conflit)
npm run dev                      # http://localhost:5173
npm run build                    # tsc --noEmit puis vite build → dist/
npm run preview
```

Lien direct vers une donnée du catalogue : `http://localhost:5173/?donnee=IGNF_BD-TOPO`.

## Tests

```bash
npm run lint         # vérification de types
npm test             # 165 tests unitaires (recherche, sémantique, contacts, Markdown, géographie, SIG, extraction, authentification), sans réseau
npm run test:live    # vérifie sur le VRAI catalogue que chaque produit/thème du thésaurus existe encore
npm run test:e2e     # 11 scénarios Playwright sur les VRAIES APIs (réseau + Chrome installé)

# Recherche sémantique (outillage)
npm run download:model   # modèle d'embeddings dans ./.models/ (curl)
npm run build:semantic   # régénère public/semantic/index.json
npm run test:semantic    # évaluation lexical / sémantique / hybride + balayage des réglages
```

Les tests unitaires utilisent des fixtures et des services simulés clairement identifiés (`tests/fixtures.ts`, `fakeApi`, faux service d'extraction dans `tests/extraction.test.ts`). L'application elle-même n'utilise jamais de données simulées.

## Déploiement (GitHub Pages)

Le workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) vérifie les types, lance les tests unitaires, construit l'application et la publie sur GitHub Pages à chaque push sur `main`. Prérequis, une seule fois : *Settings › Pages › Build and deployment › Source : GitHub Actions*.

L'application est statique (chemins relatifs, aucun serveur) : tout service d'hébergement de fichiers convient (`dist/`).

## Architecture

```
src/
  api/         réseau + parsing : http, catalogue, searchIndex, download, places, wmts
  search/      analyse d'une saisie en langage courant (analyze), thésaurus de besoins (thesaurus), recherche sémantique locale (semantic)
  services/    GeoPlatformService (façade), search.ts (fusion + classement), coverage.ts (zone ↔ emprise), resources.ts (zone → fichiers)
  extraction/  api, models, builder (requête + rapprochement produit), fit (budget de taille), twkb, srs, controller
  auth/        jeton Bearer + OAuth2 PKCE (inactif sans client dédié)
  gis/         GISIntegrationService, capabilities/ (recommandation, validation d'URL), export/ (.qlr), adapters/{qgis,generic}
  map/         OpenLayers + extensions Géoplateforme (repli sur un fond WMTS direct)
  state/       Store et états IDLE/LOADING/READY/EMPTY/PARTIAL/ERROR
  components/  views.ts (recherche, fiche, zone, onglets), modale, helpers DOM
  utils/       géométrie (bbox, surface, reprojection, WKT, simplification)
scripts/       génération de l'index sémantique, téléchargement du modèle
```

Aucun `fetch()` dans les composants : tout passe par `services/` ou `extraction/`. Chaque requête est annulable (`AbortController`), avec timeout et erreurs typées.

## APIs utilisées

| API | Rôle | Documentation | Endpoint réellement utilisé |
|---|---|---|---|
| Catalogue GeoNetwork 4 | Fiches, liens de services et de téléchargement, contacts | config de cartes.gouv.fr (`…/assets/configuration/default.toml`) | `POST https://data.geopf.fr/catalog/search/records/_search?bucket=bucket` (`Accept: application/json` obligatoire) |
| Index de recherche | Couches publiées (dont absentes du catalogue) et accès restreint | `https://data.geopf.fr/recherche/swagger-ui/index.html` | `POST https://data.geopf.fr/recherche/api/indexes/geoplateforme?page=&size=` — corps = filtre par champ (`title`, `keywords`, `description`…), pas de plein texte ni de total |
| Téléchargement | Éditions, zones, formats, fichiers et tailles | `…/telechargement/swagger-ui/index.html` | `GET /telechargement/resource/{ressource}?zone=&format=&limit=&page=` et `/{édition}` |
| Extraction | Découpe des tables vecteur à la zone | `https://data.geopf.fr/extraction/swagger-ui/index.html` | `GET /processes`, `/processes/{id}`, lien `describedby`, `POST /processes/{id}/execution`, `GET/DELETE /jobs/{id}`, `GET /jobs/{id}/results` — jeton Bearer obligatoire |
| SSO | Connexion | `https://sso.geopf.fr/realms/geoplateforme/.well-known/openid-configuration` | `…/protocol/openid-connect/{auth,token}` (PKCE S256 supporté) |
| Géocodage | Recherche de communes | `…/geocodage/swagger-ui/index.html` | `GET /geocodage/search?q=&type=municipality` |
| WFS ADMIN EXPRESS | Contour de commune, départements/régions intersectés | WFS 2.0.0 | `GET /wfs/ows`, `ADMINEXPRESS-COG.LATEST:{commune,departement,region}` (POST refusé : HTTP 500) |
| WMTS / WMS / TMS | Fond, aperçu, accès SIG | OGC | `/wmts` (GetCapabilities ≈ 3 Mo, mis en cache), `/wms-r`, `/wms-v/ows`, `/tms/1.0.0/{couche}/metadata.json` |

Vérifiés par requêtes réelles en octobre 2026, sauf les appels authentifiés de l'extraction (voir Limites).

## Parcours

1. **Recherche** : saisie libre ou bandeau dépliable de besoins ; filtres *Téléchargeable*, *Utilisable en SIG*, *Accès libre*.
2. **Fiche** : résumé, contact du producteur (adresse courriel en lien `mailto:` avec objet prérempli et bouton « Copier l'adresse », site web), informations repliables, aperçu automatique (WMTS sinon WMS), puis trois onglets. L'onglet SIG s'ouvre d'emblée quand la donnée a un géoservice.
3. **Zone (facultative, dans la fiche)** : emprise de la carte, rectangle, polygone, commune ou coordonnées. Elle sert à :
   - **vérifier la couverture** d'un géoservice : emprise annoncée par le WMTS (GetCapabilities), sinon emprise de la fiche ; comparaison de rectangles englobants (elle écarte un secteur manifestement hors couverture, sans prouver la présence de données en tout point) ;
   - télécharger les fichiers du territoire, ou extraire.
4. **Onglets** :
   - *Utiliser dans un SIG* : sans zone ; mode recommandé automatiquement (WMTS > WMS > WFS > TMS), `.qlr` QGIS, URI de connexion, URL de service ;
   - *Télécharger* : dernière version ou choix, volume réel, options avancées (variante, format, accès techniques) ;
   - *Extraire* : voir plus bas.

### Zone → fichiers (méthode)

Zone → départements/régions intersectés (WFS ADMIN EXPRESS ; géométrie simplifiée ≈ 20 m puis **rétrécie de 30 m** pour ignorer un simple contact de bordure) → zones de l'API de téléchargement (département, sinon région, sinon `FXX`, sinon `FRA`) → édition la plus récente dans le format choisi → taille réelle du fichier. Le volume n'est affiché que si toutes les tailles sont connues. Les ressources de téléchargement ne décrivent pas de dalles (`polygon` toujours nul) : la correspondance se fait par territoire.

### Accès restreint

L'index de recherche expose les offres non ouvertes (`open: false`, URL sous `/private/`) ; le catalogue en publie aussi des liens. L'application les **affiche et les signale** (badges « Accès restreint » / « Accès libre et restreint »), mais ne les affiche pas sur la carte et ne les propose pas en SIG : elles exigent des droits qu'elle ne peut pas obtenir. Le filtre « Accès libre » les écarte de la liste.

## Recherche par besoin (méthode)

1. **Analyse** (`src/search/analyze.ts`) : accents, casse, pluriels, retrait des mots d'amorce (« je cherche les… »), reconnaissance des besoins du thésaurus tolérante à une faute de frappe (distance d'édition ≤ 1).
2. **Thésaurus** (`src/search/thesaurus.ts`, 25 besoins) : liste **éditoriale** reliant un besoin à des thèmes INSPIRE portés par les fiches du catalogue, à des titres de produits de référence et à des termes pour l'index. `npm run test:live` échoue si un produit ou un thème n'existe plus dans le catalogue : il doit être entretenu à la main.
3. **Catalogue** : une requête pondérée — nom saisi ×8, phrase ×4, produits du besoin ×10, thèmes INSPIRE ×3, flou sur titre et mots-clés (le résumé n'est consulté que si aucun besoin n'est reconnu : sinon trop de bruit).
4. **Index de recherche** (filtre par champ, sans plein texte) : jusqu'à 4 termes × `title`/`keywords`/`description`.
5. **Classement** (`services/search.ts`) : score Elasticsearch normalisé, bonus produit de référence (+10), thème (+3), nom saisi (+12) ; un besoin générique (« carte ») s'efface devant un besoin précis (« anciennes ») ; le catalogue passe avant l'index à égalité. La raison est affichée (« Produit de référence — Bâtiments »).

Limite : un besoin absent du thésaurus retombe sur la recherche floue classique (titre, mots-clés, résumé), moins pertinente.

### Recherche sémantique locale (facultative)

Bouton « Activer la recherche intelligente » sous la barre de recherche. Un petit modèle d'embeddings multilingue (`Xenova/multilingual-e5-small`, quantifié 8 bits, ≈ 135 Mo avec son tokenizer) s'exécute **dans le navigateur** (transformers.js, ONNX/WASM) : aucune saisie n'est envoyée à un service externe. Le modèle est téléchargé une fois depuis Hugging Face (puis mis en cache par le navigateur) ; le choix est mémorisé (`localStorage`). Pendant le chargement, la recherche par mots-clés reste utilisable.

- **Index** (`public/semantic/index.json`, ≈ 1,4 Mo) : un vecteur par fiche du catalogue et par couche **ouverte** de l'index de recherche (titres trop courts, couches de test/démo et descriptions vides écartés), généré par `scripts/build-semantic-index.mjs` avec le même modèle. Il est figé à sa date de génération (`createdAt`) : à **régénérer quand le catalogue change**. L'API de l'index plafonne chaque requête à 10 000 documents, d'où un partitionnement par protocole.
- **Fusion** (`services/search.ts`) : similarité cosinus ; seuls les résultats très proches sont retenus (plancher 0,88, écart ≤ 0,05 avec le meilleur) ; ils reçoivent un bonus (≤ 12, réduit de 30 % pour les couches de l'index) ajouté au classement lexical, ou sont ajoutés s'ils manquaient (hydratation par identifiant). La raison est affichée : « Sens proche de votre recherche ».
- **Mesure** (`tests/semantic.live.test.ts` : 30 requêtes en langage courant rédigées pour l'évaluation, + 6 requêtes sans réponse attendue) :

  | | succès@5 | MRR@5 |
  |---|---|---|
  | lexical seul | 25/30 | 0,775 |
  | sémantique seul | 24/30 | 0,667 |
  | hybride, plancher 0,88 (retenu) | 25/30 | 0,800 |
  | hybride, plancher 0,86 | 27/30 | 0,815 (1/6 faux positif) |
  | hybride, plancher 0,80 | 27/30 | 0,813 (6/6 faux positifs) |

  Le plancher a été choisi pour **ne remonter aucune fausse réponse** sur les requêtes sans bonne réponse (« recette de gâteau », « météo », « stations de recharge » — sans donnée ouverte correspondante, le modèle renvoyait des stations hydrométriques). Le gain est donc **modeste** (+0,025 de MRR) : les scores cosinus du modèle sont très serrés (0,80–0,90) et les requêtes d'évaluation recoupent en partie le thésaurus.

## Connexion et extraction

**Connexion** (bouton en en-tête) : jeton Bearer collé (voir ci-dessous), gardé en mémoire ou, sur demande, en `sessionStorage` ; envoyé uniquement à `data.geopf.fr`. L'identité et l'expiration sont lues dans le JWT (sans vérification de signature : le serveur reste juge).

**Obtenir un jeton** (aide aussi disponible dans la fenêtre de connexion) :

- *Depuis QGIS*, si vous êtes déjà connecté avec le plugin **Géoplateforme pour QGIS** (configuration d'authentification Géoplateforme) : ouvrir la console Python (*Extensions › Console Python*), afficher l'éditeur, coller le script [`src/auth/qgisTokenScript.ts`](src/auth/qgisTokenScript.ts) (le bouton « Copier le script » de la fenêtre de connexion le fournit) et l'exécuter. Il demande à QGIS l'en-tête d'authentification de chaque configuration, **sans émettre la requête** (l'en-tête est lu localement), et affiche `Bearer …` ; copier la valeur de la configuration Géoplateforme. Si la session a expiré, QGIS peut proposer de se reconnecter : relancer le script ensuite.
- *Depuis le Swagger* d'extraction (<https://data.geopf.fr/extraction/swagger-ui/index.html>) : bouton *Authorize*, puis le jeton apparaît dans la commande `curl` générée par *Try it out*.

Le jeton est temporaire (quelques dizaines de minutes à quelques heures) ; ne le partagez pas et ne le versionnez pas.

**OAuth2 PKCE** : implémenté et testé (vecteur de la RFC 7636) mais **inactif**, car les clients publics existants (`cartes-gouv-public`, `gpf-swagger`) refusent une redirection vers une autre origine (HTTP 400 vérifié). Pour l'activer : faire enregistrer un client public OAuth2 avec l'URL de l'application comme URI de redirection, puis définir `VITE_OIDC_CLIENT_ID` à la construction.

**Extraction** (onglet « Extraire », zone et connexion requises) : liste les produits du compte, **propose** celui qui ressemble à la donnée (heuristique sur les mots du titre — le catalogue et le service n'ont pas d'identifiant commun ; l'utilisateur peut en choisir un autre), lit ses tables et sa projection native, construit un filtre `ST_Intersects(géométrie, contour)` par table, lance le job, suit son état toutes les 15 s et affiche les fichiers du résultat. Le contour est envoyé en TWKB hexadécimal dans la projection native (EPSG:2154, outre-mer UTM) ; le service refuse les requêtes de plus de ≈ 256 Ko, donc budget de 200 Ko réparti entre les tables : contour précis, sinon simplifié puis élargi de sa tolérance, sinon rectangle englobant (le contour réellement envoyé est indiqué). Un seul job à la fois par compte (HTTP 429 expliqué), jobs de plusieurs minutes, annulation possible, rapport d'erreur copiable (sans le jeton).

## Intégration SIG

`GISIntegrationService` reçoit `{ resource, availableServices, selectedArea, selectedLayer }` et interroge des adaptateurs (`GisClientAdapter`) : **QGIS** et **autre logiciel compatible**. Ajouter un logiciel = un adaptateur de plus.

### QGIS

Documentation QGIS consultée (ligne de commande, ouverture de données) : fichiers et projets en ligne de commande, `.qlr` en glisser-déposer, connexions importables, panneau Explorateur ; **aucun schéma d'URL ni gestionnaire de protocole**.

- **Retenu** : fichier `.qlr` généré dans le navigateur (données seulement : URI + XML échappé, aucun code, URLs https validées) + URI de connexion copiable. WMS, WMTS et WFS ; le TMS (tuiles vectorielles) se limite à l'URL `metadata.json` à copier.
- **Vérifié** : un `.qlr` (WMS + WMTS + WFS) charge 3 couches valides dans un QGIS réel (`QgsLayerDefinition.loadLayerDefinition`).
- **Sans plugin** : double-clic (si QGIS est associé aux `.qlr`, non vérifié partout), glisser-déposer, ou *Couche › Ajouter depuis un fichier de définition de couche*.
- **Impossible** : « Ouvrir dans QGIS » en un clic depuis le navigateur — non simulé.

## Limites connues

- **L'extraction n'a pas été testée contre le service réel** (jeton indisponible pendant le développement). Les endpoints et le format des requêtes/réponses reposent sur l'OpenAPI du service ; le comportement est vérifié sur un service **simulé** (tests unitaires) et le chemin « jeton refusé » sur le vrai service (E2E : HTTP 401). À valider avec un vrai jeton.
- La connexion automatique (PKCE) est inactive tant qu'aucun client dédié n'existe.
- Le rapprochement donnée ↔ produit d'extraction est une heuristique ; seuls les champs à liste de choix ou à case à cocher sont éditables (valeurs par défaut du produit sinon).
- **Contact du producteur** : l'adresse n'est affichée que si les métadonnées la publient (catalogue : `contactForResource`, par exemple contact.geoservices@ign.fr pour la BD TOPO ; index : `attribution.email`, présent sur 20 documents seulement sur les 8 655 qui ont une attribution). Pour la plupart des couches de l'index, notamment restreintes, seul le nom du producteur et parfois son site sont connus : l'application l'indique plutôt que de deviner une adresse.
- **Recherche sémantique** : modèle de ≈ 135 Mo téléchargé depuis Hugging Face (et moteur WASM depuis jsDelivr par défaut) ; index figé à régénérer ; offres restreintes absentes de l'index sémantique (la recherche lexicale les signale) ; gain mesuré modeste.
- Téléchargement : fichiers par territoire entier (pas de découpe sans extraction), pas de choix de projection. Les ressources organisées en dalles (LiDAR HD…) n'ont pas été testées.
- L'index de recherche n'offre ni plein texte ni total : la recherche combine `title`, `keywords` et `description` ; les offres `DOWNLOAD` et `ALTIMETRY` de l'index ne sont pas exploitées.
- L'extension OpenLayers charge sa configuration depuis les services Géoplateforme au démarrage ; repli prévu en cas d'échec.
- Le script DSFR retire la classe d'ouverture `fr-modal--opened` : la modale est pilotée par l'application. Les accordéons sont des `<details>` natifs.
- Poids : CSS DSFR complet (≈ 3 Mo, 400 Ko gzip) et JS ≈ 1,2 Mo.
- Accessibilité : clavier, libellés, `aria-live`, onglets WAI-ARIA, piège de focus de la modale et alternatives non cartographiques sont implémentés ; **aucun audit RGAA ni test avec lecteur d'écran**. Responsive contrôlé visuellement à 375 px et en desktop.

## Licences et mentions

- Code de ce dépôt : **GNU AGPL-3.0** (voir [LICENSE](LICENSE)), car l'application embarque [geopf-extensions-openlayers](https://github.com/IGNF/geopf-extensions-openlayers), publiée sous AGPL-3.0.
- Le [DSFR](https://github.com/GouvernementFR/dsfr) et la police Marianne sont réservés aux sites et applications des services publics (voir leurs [conditions d'utilisation](https://github.com/GouvernementFR/dsfr/blob/main/doc/legal/cgu.md)). Cette application étant **non officielle**, elle n'en reprend pas le bloc-marque (Marianne, « République Française »).
- Données : fonds et données © IGN / Géoplateforme et producteurs respectifs, selon les licences indiquées dans chaque fiche.
- Modèle d'embeddings : `Xenova/multilingual-e5-small` (conversion ONNX de `intfloat/multilingual-e5-small`, licence MIT).
