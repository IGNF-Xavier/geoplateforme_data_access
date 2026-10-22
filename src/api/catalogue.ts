/**
 * Catalogue de la Géoplateforme (GeoNetwork 4, le même que cartes.gouv.fr).
 * La config de l'application cartes.gouv.fr
 * (https://cartes.gouv.fr/rechercher-une-donnee/assets/configuration/default.toml)
 * pointe vers https://data.geopf.fr/catalog.
 *
 * Endpoint effectivement utilisé : POST /catalog/search/records/_search?bucket=bucket
 * (Elasticsearch). L'en-tête `Accept: application/json` est indispensable (sans lui
 * le service répond 400). Aucun en-tête X-XSRF-TOKEN n'est nécessaire.
 */
import type { BBox, Contact, Dataset, DownloadResourceRef, ServiceAccess, ServiceKind } from '../types'
import { analyze, type Analysis } from '../search/analyze'
import { fetchJson, type RequestOptions } from './http'

export const CATALOGUE_URL = 'https://data.geopf.fr/catalog/search/records/_search?bucket=bucket'

const SOURCE_FIELDS = [
  'uuid',
  'resourceTitleObject',
  'resourceAbstractObject',
  'OrgForResourceObject',
  'resourceType',
  'changeDate',
  'resourceEdition',
  'resolutionScaleDenominator',
  'licenseObject',
  'resourceTemporalExtentDetails',
  'geom',
  'inspireTheme',
  'contactForResource',
  'link',
]

interface LocalizedText {
  default?: string
  langfre?: string
}

interface CatalogueLink {
  protocol?: string
  urlObject?: LocalizedText
  nameObject?: LocalizedText
}

export interface CatalogueSource {
  uuid: string
  resourceTitleObject?: LocalizedText
  resourceAbstractObject?: LocalizedText
  OrgForResourceObject?: LocalizedText
  resourceType?: string[]
  changeDate?: string
  resourceEdition?: string
  resolutionScaleDenominator?: string[]
  licenseObject?: LocalizedText[]
  resourceTemporalExtentDetails?: { start?: { date?: string }; end?: { date?: string } }[]
  geom?: GeoJSON.Geometry | GeoJSON.Geometry[]
  inspireTheme?: string[] | string
  contactForResource?: {
    email?: string
    organisationObject?: LocalizedText
    website?: string
    role?: string
    address?: string
  }[]
  link?: CatalogueLink[]
}

export interface CatalogueResponse {
  hits: { total: { value: number }; hits: { _score?: number; _source: CatalogueSource }[] }
}

const TYPE_LABELS: Record<string, string> = {
  dataset: 'Jeu de données',
  series: 'Collection de données',
  service: 'Service',
  nonGeographicDataset: 'Données non géographiques',
}

const PROTOCOL_KINDS: Record<string, ServiceKind> = {
  'OGC:WMTS': 'WMTS',
  'OGC:WMS': 'WMS',
  'OGC:WFS': 'WFS',
  TMS: 'TMS',
}

const DOWNLOAD_RESOURCE_RE = /^https:\/\/data\.geopf\.fr\/telechargement\/resource\/([^/?#]+)\/?$/

const text = (t?: LocalizedText) => t?.default ?? t?.langfre

/** Retire la query-string (GetCapabilities…) d'une URL de service. */
export function stripQuery(url: string): string {
  const i = url.indexOf('?')
  return i === -1 ? url : url.slice(0, i)
}

const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[A-Za-z]{2,}$/

/** Adresse courriel plausible (une seule adresse, sans caractère de contrôle), sinon `undefined`. */
export function cleanEmail(value?: string): string | undefined {
  const email = value?.trim()
  return email && email.length <= 254 && EMAIL_RE.test(email) ? email : undefined
}

/** Lien `mailto:` avec objet prérempli ; `undefined` si l'adresse n'est pas valide. */
export function mailtoLink(email: string | undefined, subject: string): string | undefined {
  const clean = cleanEmail(email)
  return clean ? `mailto:${clean}?subject=${encodeURIComponent(subject)}` : undefined
}

/** Contacts publiés dans la fiche, dédoublonnés par adresse (ou organisation). */
export function parseContacts(source: CatalogueSource): Contact[] {
  const seen = new Set<string>()
  const contacts: Contact[] = []
  for (const c of source.contactForResource ?? []) {
    const contact: Contact = {
      organisation: text(c.organisationObject) || undefined,
      email: cleanEmail(c.email),
      website: c.website && isHttpUrl(c.website) ? c.website : undefined,
      role: c.role || undefined,
      address: c.address?.trim() || undefined,
    }
    const key = contact.email ?? contact.organisation ?? ''
    if (!key || seen.has(key) || (!contact.email && !contact.website && !contact.organisation)) continue
    seen.add(key)
    contacts.push(contact)
  }
  return contacts
}

/** http(s) uniquement. */
function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/** Les endpoints `/private/` sont ceux des offres non ouvertes (accès réservé). */
export const isPrivateUrl = (url: string): boolean => /\/private\//.test(url)

function bboxOfGeometry(geom: GeoJSON.Geometry): BBox | undefined {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [x, y] = c as number[]
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    } else if (Array.isArray(c)) c.forEach(visit)
  }
  if ('coordinates' in geom) visit(geom.coordinates)
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : undefined
}

/**
 * Transforme un enregistrement GeoNetwork en `Dataset`. Seules les informations
 * réellement présentes sont renseignées ; rien n'est déduit ni inventé.
 */
export function parseRecord(source: CatalogueSource): Dataset {
  const services: ServiceAccess[] = []
  const downloads: DownloadResourceRef[] = []
  const documentation: { title: string; url: string }[] = []
  const seen = new Set<string>()

  for (const link of source.link ?? []) {
    const url = text(link.urlObject)
    if (!url || !isHttpUrl(url)) continue
    const name = text(link.nameObject) ?? ''
    const kind = link.protocol ? PROTOCOL_KINDS[link.protocol] : undefined

    if (kind && name) {
      const key = `${kind}|${stripQuery(url)}|${name}`
      if (seen.has(key)) continue
      seen.add(key)
      services.push({
        kind,
        endpoint: stripQuery(url),
        capabilitiesUrl: kind === 'TMS' ? undefined : url,
        layer: name,
        restricted: isPrivateUrl(url) || undefined,
      })
    } else if (link.protocol?.startsWith('WWW:DOWNLOAD')) {
      const match = DOWNLOAD_RESOURCE_RE.exec(url)
      if (match && !downloads.some((d) => d.id === match[1])) {
        downloads.push({ id: decodeURIComponent(match[1]), title: name || match[1], url })
      }
    } else if (!link.protocol && /\.(pdf|zip)(\?|$)/i.test(url)) {
      documentation.push({ title: name || url.split('/').pop() || url, url })
    }
  }

  const geoms = Array.isArray(source.geom) ? source.geom : source.geom ? [source.geom] : []
  const extents = geoms.map(bboxOfGeometry).filter((b): b is BBox => !!b)
  const temporal = source.resourceTemporalExtentDetails?.[0]

  return {
    id: source.uuid,
    source: 'catalogue',
    title: text(source.resourceTitleObject) ?? source.uuid,
    abstract: text(source.resourceAbstractObject),
    producer: text(source.OrgForResourceObject),
    type: source.resourceType?.[0] ? (TYPE_LABELS[source.resourceType[0]] ?? source.resourceType[0]) : undefined,
    updatedAt: source.changeDate,
    edition: source.resourceEdition,
    license: text(source.licenseObject?.[0]),
    resolutions: source.resolutionScaleDenominator?.map((r) => `1 : ${Number(r).toLocaleString('fr-FR')}`),
    temporalExtent: temporal ? { start: temporal.start?.date, end: temporal.end?.date } : undefined,
    extents,
    downloads,
    services,
    documentation,
    contacts: parseContacts(source),
    inspireThemes: source.inspireTheme === undefined ? undefined : [source.inspireTheme].flat(),
  }
}

export function parseCatalogueResponse(response: CatalogueResponse): { total: number; datasets: Dataset[] } {
  const hits = response?.hits?.hits
  if (!Array.isArray(hits)) throw new Error('Réponse du catalogue inattendue.')
  return {
    total: response.hits.total?.value ?? hits.length,
    datasets: hits.map((h) => ({ ...parseRecord(h._source), relevance: h._score ?? undefined })),
  }
}

/**
 * Requête de recherche : un seul appel pondéré, du plus précis au plus tolérant.
 *  - nom de produit saisi (préfixe du titre) ×8, phrase dans titre/mots-clés ×4 ;
 *  - pour chaque besoin reconnu (thésaurus) : titres de produits de référence ×10 et thèmes
 *    INSPIRE de la fiche ×3 ;
 *  - correspondance floue (fautes de frappe, mots dans le désordre) : titre et mots-clés ;
 *    le résumé n'est consulté que si aucun besoin n'a été reconnu (sinon trop de bruit).
 */
export function buildSearchBody(input: string | Analysis, size: number, from = 0) {
  const a = typeof input === 'string' ? analyze(input) : input
  const base = { from, size, _source: SOURCE_FIELDS }
  if (!a.phrase) return { ...base, query: { match_all: {} } }
  const fuzzyFields = ['resourceTitleObject.default^3', 'tag.default^2']
  const should: unknown[] = [
    { match_phrase_prefix: { 'resourceTitleObject.default': { query: a.raw, boost: 8 } } },
    { multi_match: { query: a.phrase, type: 'phrase', fields: fuzzyFields, boost: 4 } },
    ...a.concepts.flatMap((c) => [
      ...c.products.map((p) => ({ match_phrase: { 'resourceTitleObject.default': { query: p, boost: 10 } } })),
      ...(c.themes.length ? [{ terms: { inspireTheme: c.themes, boost: 3 } }] : []),
    ]),
    {
      multi_match: {
        query: a.phrase,
        fuzziness: 'AUTO',
        operator: 'or',
        minimum_should_match: '2<75%',
        fields: a.concepts.length ? fuzzyFields : [...fuzzyFields, 'resourceAbstractObject.default'],
      },
    },
  ]
  return { ...base, query: { bool: { should, minimum_should_match: 1 } } }
}

async function post(body: unknown, options: RequestOptions) {
  return fetchJson<CatalogueResponse>(CATALOGUE_URL, {
    ...options,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    },
  })
}

export async function searchDatasets(query: string | Analysis, options: RequestOptions & { size?: number; from?: number } = {}) {
  const { size = 20, from = 0, ...rest } = options
  return parseCatalogueResponse(await post(buildSearchBody(query, size, from), rest))
}

export async function getDatasetById(id: string, options: RequestOptions = {}): Promise<Dataset | undefined> {
  const response = await post({ size: 1, _source: SOURCE_FIELDS, query: { term: { uuid: id } } }, options)
  return parseCatalogueResponse(response).datasets[0]
}

/** Fiches du catalogue à partir de leurs identifiants (hydratation des résultats sémantiques). */
export async function getDatasetsByIds(ids: string[], options: RequestOptions = {}): Promise<Dataset[]> {
  if (ids.length === 0) return []
  const response = await post({ size: ids.length, _source: SOURCE_FIELDS, query: { terms: { uuid: ids } } }, options)
  return parseCatalogueResponse(response).datasets
}
