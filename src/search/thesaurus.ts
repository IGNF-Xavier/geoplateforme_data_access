/**
 * Thésaurus de BESOINS : fait le lien entre ce que l'utilisateur veut (« les bâtiments »,
 * « l'altitude », « photos aériennes ») et les données qui y répondent, sans qu'il connaisse
 * le nom des produits. C'est une liste ÉDITORIALE maintenue à la main : chaque terme de
 * produit a été vérifié contre le catalogue réel (cf. tests/thesaurus.live.test.ts, qui
 * échoue si un produit n'existe plus).
 *
 * Pour chaque besoin :
 *  - `triggers`  : mots ou expressions de l'utilisateur (sans accents, au singulier) ;
 *  - `themes`    : thèmes INSPIRE officiels portés par les fiches du catalogue (champ
 *                  `inspireTheme`) — rapprochement fondé sur les métadonnées elles-mêmes ;
 *  - `products`  : titres de produits phares, recherchés dans le titre des fiches ;
 *  - `indexTerms`: termes pour l'index de recherche (qui n'a pas de thème INSPIRE).
 */
export interface Concept {
  id: string
  label: string
  /** Texte d'aide affiché sur la puce de suggestion. */
  hint: string
  triggers: string[]
  themes: string[]
  products: string[]
  indexTerms: string[]
  /** Besoin très large (ex. « carte ») : s'efface devant un besoin plus précis reconnu dans la même saisie. */
  generic?: boolean
}

export const CONCEPTS: Concept[] = [
  {
    id: 'batiments', label: 'Bâtiments', hint: 'maisons, immeubles, emprises',
    triggers: ['batiment', 'bati', 'maison', 'immeuble', 'construction', 'habitation', 'toit', 'emprise au sol'],
    themes: ['buildings'], products: ['BD TOPO'], indexTerms: ['bâtiment', 'bâti'],
  },
  {
    id: 'routes', label: 'Routes et rues', hint: 'voirie, réseau routier',
    triggers: ['route', 'rue', 'voirie', 'chaussee', 'reseau routier', 'autoroute', 'chemin', 'sentier', 'itineraire', 'circulation'],
    themes: ['transport networks'], products: ['ROUTE 500', 'BD TOPO', 'VOIRIE'], indexTerms: ['route', 'réseau routier'],
  },
  {
    id: 'relief', label: 'Altitude et relief', hint: 'MNT, pente, courbes de niveau',
    triggers: ['altitude', 'relief', 'mnt', 'mns', 'elevation', 'pente', 'denivele', 'topographie', 'courbe de niveau', 'terrain', 'hauteur du sol'],
    themes: ['elevation'], products: ['RGE ALTI', 'BD ALTI', 'France RELIEF', 'Courbes de niveau'], indexTerms: ['altimétrie', 'MNT', 'relief'],
  },
  {
    id: 'lidar', label: 'LiDAR et 3D', hint: 'nuages de points, hauteur de la végétation',
    triggers: ['lidar', 'nuage de point', '3d', 'mnh', 'canopee', 'hauteur de vegetation', 'modele numerique'],
    themes: [], products: ['LiDAR HD', 'MNH'], indexTerms: ['LIDARHD', 'MNH'],
  },
  {
    id: 'photos', label: 'Photos aériennes', hint: 'orthophotographies, imagerie',
    triggers: ['photo aerienne', 'photographie aerienne', 'orthophoto', 'orthophotographie', 'image aerienne', 'vue aerienne', 'satellite', 'ortho', 'imagerie', 'photo'],
    themes: ['orthoimagery'], products: ['BD ORTHO', 'ORTHO'], indexTerms: ['orthophotographie', 'ORTHOIMAGERY'],
  },
  {
    id: 'cartes', label: 'Cartes IGN', generic: true, hint: 'cartes topographiques, Plan IGN, SCAN',
    triggers: ['carte', 'plan', 'scan', 'fond de carte', 'carte topographique', 'carte ign'],
    themes: [], products: ['SCAN 25', 'SCAN 100', 'Plan IGN'], indexTerms: ['Plan IGN', 'SCAN'],
  },
  {
    id: 'anciennes', label: 'Cartes et images anciennes', hint: 'Cassini, État-Major, historique',
    triggers: ['ancien', 'ancienne', 'historique', 'autrefois', 'passe', 'cassini', 'etat major', 'evolution', 'remonter le temps'],
    themes: [], products: ['Cassini', 'Etat-Major'], indexTerms: ['Cassini', 'Etat-Major', 'historique'],
  },
  {
    id: 'cadastre', label: 'Cadastre et parcelles', hint: 'propriété, foncier',
    triggers: ['cadastre', 'parcelle', 'parcellaire', 'propriete', 'foncier', 'unite fonciere'],
    themes: ['cadastral parcels'], products: ['BD PARCELLAIRE', 'Parcellaire Express', 'Cadastre'], indexTerms: ['parcelle', 'cadastre'],
  },
  {
    id: 'foret', label: 'Forêts et végétation', hint: 'arbres, haies, boisements',
    triggers: ['foret', 'arbre', 'bois', 'vegetation', 'boisement', 'haie', 'essence', 'sylviculture'],
    themes: [], products: ['BD Forêt', 'Masque Forêt', 'Forêts Publiques', 'BD HAIE'], indexTerms: ['forêt', 'végétation'],
  },
  {
    id: 'eau', label: 'Eau et cours d’eau', hint: 'rivières, lacs, zones humides',
    triggers: ['eau', 'riviere', 'cours d eau', 'fleuve', 'lac', 'hydro', 'hydrographie', 'ruisseau', 'zone humide', 'etang'],
    themes: ['hydrography'], products: ['zones humides', 'Masses d\x27eau', 'BD TOPO'], indexTerms: ['hydrographie', 'cours d\'eau'],
  },
  {
    id: 'limites', label: 'Limites administratives', hint: 'communes, départements, régions',
    triggers: ['commune', 'departement', 'region', 'limite administrative', 'frontiere', 'epci', 'canton', 'territoire', 'decoupage', 'contour', 'administratif'],
    themes: ['administrative units'], products: ['ADMIN EXPRESS', 'GEOFLA'], indexTerms: ['limites administratives', 'commune'],
  },
  {
    id: 'adresses', label: 'Adresses', hint: 'BAN, numéros de rue',
    triggers: ['adresse', 'ban', 'geocodage', 'numero de rue', 'geocoder'],
    themes: ['addresses'], products: ['ADRESSE PREMIUM', 'BAN PLUS'], indexTerms: ['adresse'],
  },
  {
    id: 'occupation', label: 'Occupation du sol', hint: 'artificialisation, usage des sols',
    triggers: ['occupation du sol', 'land cover', 'artificialisation', 'urbanisation', 'couverture du sol', 'ocs', 'corine', 'usage du sol', 'utilisation du sol'],
    themes: ['land cover', 'land use'], products: ['OCS GE', 'CORINE Land Cover', 'COSIA'], indexTerms: ['occupation du sol', 'OCS'],
  },
  {
    id: 'agriculture', label: 'Agriculture', hint: 'cultures, parcelles agricoles (RPG)',
    triggers: ['agricole', 'agriculture', 'culture', 'rpg', 'exploitation', 'viticole', 'vigne', 'prairie', 'ble'],
    themes: ['agricultural and aquaculture facilities'], products: ['RPG', 'BD HAIE'], indexTerms: ['agricole', 'RPG'],
  },
  {
    id: 'biodiversite', label: 'Biodiversité et espaces protégés', hint: 'Patrinat, INPN, Natura 2000, parcs',
    triggers: ['biodiversite', 'nature', 'espece', 'faune', 'flore', 'protege', 'natura 2000', 'parc national', 'znieff', 'reserve', 'patrimoine naturel', 'inpn', 'mnhn', 'museum', 'habitat', 'patrinat'],
    themes: ['protected sites', 'habitats and biotopes'], products: ['CARHAB'], indexTerms: ['Patrinat', 'INPN', 'biodiversité', 'espaces protégés'],
  },
  {
    id: 'risques', label: 'Risques naturels', hint: 'inondation, PPR, aléas',
    triggers: ['risque', 'inondation', 'ppr', 'ppri', 'seisme', 'danger', 'alea', 'incendie', 'mouvement de terrain', 'submersion', 'catastrophe'],
    themes: [], products: ['Risque', 'PPRI', 'Territoire à Risque Important'], indexTerms: ['risque', 'inondation'],
  },
  {
    id: 'urbanisme', label: 'Urbanisme', hint: 'PLU, servitudes, zonage',
    triggers: ['urbanisme', 'plu', 'plui', 'zonage', 'document d urbanisme', 'scot', 'servitude', 'constructibilite', 'sup'],
    themes: [], products: [], indexTerms: ['PLU', 'urbanisme', 'servitude'],
  },
  {
    id: 'transports', label: 'Transports', hint: 'rail, aéroports, bornes de recharge',
    triggers: ['train', 'ferroviaire', 'gare', 'aeroport', 'aerodrome', 'port', 'metro', 'tramway', 'transport', 'mobilite', 'velo', 'piste cyclable', 'irve', 'borne de recharge'],
    themes: [], products: ['IRVE', 'TRANSPORTS EXCEPTIONNELS'], indexTerms: ['ferroviaire', 'transport', 'aérodrome', 'IRVE'],
  },
  {
    id: 'energie', label: 'Énergie', hint: 'éolien, solaire, réseaux',
    triggers: ['energie', 'electricite', 'eolien', 'photovoltaique', 'solaire', 'ligne electrique', 'gaz', 'enr', 'renouvelable'],
    themes: ['energy resources'], products: ['ENR'], indexTerms: ['énergie', 'éolien', 'ENR'],
  },
  {
    id: 'toponymes', label: 'Noms de lieux', hint: 'toponymes, lieux-dits',
    triggers: ['toponyme', 'lieu dit', 'nom de lieu', 'nom geographique', 'denomination', 'lieux nomme'],
    themes: ['geographical names'], products: ['BD TOPO'], indexTerms: ['lieux nommés', 'toponyme'],
  },
  {
    id: 'population', label: 'Population et statistiques', hint: 'IRIS, INSEE, carroyage',
    triggers: ['population', 'habitant', 'demographie', 'statistique', 'iris', 'insee', 'recensement', 'carroyage'],
    themes: ['statistical units', 'répartition de la population démographie'], products: ['IRIS', 'INSEE'], indexTerms: ['IRIS', 'statistique'],
  },
  {
    id: 'geologie', label: 'Géologie et sols', hint: 'cartes géologiques, pédologie',
    triggers: ['geologie', 'sol', 'sous sol', 'roche', 'carte geologique', 'pedologie'],
    themes: ['geology', 'soil'], products: ['Cartes géologiques', 'sols'], indexTerms: ['géologie', 'sols'],
  },
  {
    id: 'littoral', label: 'Littoral et mer', hint: 'trait de côte, limites maritimes',
    triggers: ['littoral', 'mer', 'cote', 'trait de cote', 'maritime', 'plage', 'bathymetrie'],
    themes: [], products: ['littoral', 'Délimitations maritimes'], indexTerms: ['littoral', 'trait de côte', 'maritime'],
  },
  {
    id: 'geodesie', label: 'Géodésie', hint: 'repères, nivellement',
    triggers: ['geodesie', 'nivellement', 'repere', 'borne', 'point geodesique'],
    themes: [], products: ['GEODESIE ET NIVELLEMENT'], indexTerms: ['géodésie', 'nivellement'],
  },
  {
    id: 'drone', label: 'Drones', hint: 'zones de restriction de vol',
    triggers: ['drone', 'uas', 'aeronef', 'restriction de vol', 'zone interdite'],
    themes: [], products: ['Restrictions UAS', 'ZICAD'], indexTerms: ['drone', 'UAS'],
  },
]
