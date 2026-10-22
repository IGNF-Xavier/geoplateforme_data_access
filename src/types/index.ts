import type { Polygon, MultiPolygon } from 'geojson'

/** États génériques d'une opération asynchrone (cf. cahier des charges §25). */
export type Status = 'idle' | 'loading' | 'ready' | 'empty' | 'partial' | 'error'

export interface AsyncState<T> {
  status: Status
  data?: T
  /** Message utilisateur (erreur ou information de résultat partiel). */
  message?: string
}

/** [minLon, minLat, maxLon, maxLat] en WGS84 (EPSG:4326), ordre lon/lat. */
export type BBox = [number, number, number, number]

export type ServiceKind = 'WMTS' | 'WMS' | 'WFS' | 'TMS'

/** Un mode d'accès cartographique/service découvert dans le catalogue. */
export interface ServiceAccess {
  kind: ServiceKind
  /** URL du service, sans paramètres de requête OGC (GetCapabilities…). */
  endpoint: string
  /** URL GetCapabilities telle que publiée dans le catalogue (WMS/WMTS/WFS). */
  capabilitiesUrl?: string
  /** Nom de couche (WMS/WMTS), type d'entité (WFS) ou jeu de tuiles (TMS). */
  layer: string
  /** Accès réservé (offre non ouverte : exige des droits sur la Géoplateforme). */
  restricted?: boolean
}

/** Référence vers une ressource de l'API de téléchargement (ex. `BDTOPO`). */
export interface DownloadResourceRef {
  id: string
  title: string
  url: string
}

/** Contact du producteur tel que publié dans les métadonnées (rien n'est déduit). */
export interface Contact {
  organisation?: string
  /** Adresse courriel, validée ; absente si la source n'en fournit pas. */
  email?: string
  website?: string
  role?: string
  address?: string
}

export interface Dataset {
  id: string
  /** Origine de la fiche : catalogue GeoNetwork ou index de recherche Géoplateforme. */
  source: 'catalogue' | 'index'
  title: string
  abstract?: string
  producer?: string
  /** Libellé du type de ressource (jeu de données, collection…). */
  type?: string
  updatedAt?: string
  edition?: string
  license?: string
  resolutions?: string[]
  /** Bornes de couverture temporelle (ISO date). */
  temporalExtent?: { start?: string; end?: string }
  /** Étendues géographiques déclarées dans les métadonnées (WGS84). */
  extents: BBox[]
  downloads: DownloadResourceRef[]
  services: ServiceAccess[]
  documentation: { title: string; url: string }[]
  keywords?: string[]
  /** Contacts du producteur (catalogue : `contactForResource` ; index : `attribution`). */
  contacts?: Contact[]
  theme?: string
  /** Thèmes INSPIRE portés par la fiche du catalogue. */
  inspireThemes?: string[]
  /** Score de pertinence (plus grand = mieux) calculé par la recherche. */
  relevance?: number
  /** Pourquoi la donnée répond à la recherche (besoin reconnu), pour l'affichage. */
  matchReason?: string
  thumbnail?: string
}

/** Niveau d'ouverture d'une donnée, déduit de ses accès réels. */
export type AccessLevel = 'open' | 'partial' | 'restricted' | 'none'

export function accessLevel(d: Dataset): AccessLevel {
  const open = d.downloads.length + d.services.filter((s) => !s.restricted).length
  const restricted = d.services.filter((s) => s.restricted).length
  if (open && restricted) return 'partial'
  if (open) return 'open'
  return restricted ? 'restricted' : 'none'
}

export interface Place {
  label: string
  kind: string
  /** Code INSEE si c'est une commune. */
  citycode?: string
  lon: number
  lat: number
  context?: string
}

/** Zone d'intérêt de l'utilisateur, toujours stockée en WGS84. */
export interface Area {
  geometry: Polygon | MultiPolygon
  bbox: BBox
  /** Surface géodésique en m², calculée par Turf (cf. utils/geo). */
  areaSqm: number
  source: 'viewport' | 'rectangle' | 'polygon' | 'place'
  label: string
}

/** Département ou région intersectant la zone. */
export interface AdminZone {
  /** Code de zone de l'API de téléchargement (`D094`, `R11`…). */
  code: string
  name: string
  level: 'departement' | 'region'
  /** Pour un département : code de zone de sa région (`R11`). */
  parentRegion?: string
}

export interface DownloadFile {
  url: string
  fileName: string
  sizeBytes?: number
  mimeType?: string
}

export interface DatasetEdition {
  /** Identifiant de l'entrée dans l'API de téléchargement. */
  entryId: string
  title: string
  date?: string
  zone: string
  format: string
  url: string
}

export interface ResolvedDownload {
  edition: string | undefined
  format: string
  files: (DownloadFile & { zone: string; zoneLabel: string })[]
  totalBytes?: number
  /** Zones intersectées pour lesquelles aucune ressource n'existe. */
  uncovered: AdminZone[]
}
