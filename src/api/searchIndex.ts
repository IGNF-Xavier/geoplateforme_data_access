/**
 * Index de recherche de la Géoplateforme (« API Recherche »), complémentaire du
 * catalogue GeoNetwork : il référence les COUCHES publiées (WMTS, WMS, WFS, TMS), y
 * compris celles dont l'accès est réservé (`open: false`, URL sous `/private/`), et des
 * données absentes du catalogue (ex. Patrinat / INPN du MNHN).
 *
 * Doc : https://data.geopf.fr/recherche/swagger-ui/index.html
 * Endpoint utilisé : POST https://data.geopf.fr/recherche/api/indexes/geoplateforme?page=&size=
 *   Le corps est un filtre par champ (`title`, `description`, `keywords`, `theme`, `type`,
 *   `producers`, `open`…) et non une requête plein texte : on interroge donc `title`,
 *   `description` et `keywords` en parallèle puis on fusionne. Aucun total n'est renvoyé.
 */
import type { BBox, Dataset, ServiceAccess, ServiceKind } from '../types'
import { analyze, fold, type Analysis } from '../search/analyze'
import { fetchJson, type RequestOptions } from './http'
import { cleanEmail, stripQuery } from './catalogue'

export const SEARCH_INDEX_URL = 'https://data.geopf.fr/recherche/api/indexes/geoplateforme'

export interface IndexDocument {
  id: string
  offering_id?: string
  layer_name: string
  title?: string
  description?: string
  /** WMTS, WMS, WFS, TMS, mais aussi ALTIMETRY, DOWNLOAD (non exploités ici). */
  type: string
  url: string
  open?: boolean
  publication_date?: string
  keywords?: string[]
  producers?: string[]
  theme?: string
  licence?: string
  thumbnail?: string
  extent?: { type: string; coordinates: number[][][] }
  metadata_urls?: string[]
  attribution?: { title?: string; url?: string; email?: string }
}

const KINDS: Record<string, ServiceKind> = { WMTS: 'WMTS', WMS: 'WMS', WFS: 'WFS', TMS: 'TMS' }

/** GetCapabilities standard OGC, déduit de l'endpoint (l'index ne publie pas cette URL). */
function capabilitiesUrl(kind: ServiceKind, endpoint: string): string | undefined {
  return kind === 'TMS' ? undefined : `${endpoint}?SERVICE=${kind}&REQUEST=GetCapabilities`
}

function extentBBox(extent?: IndexDocument['extent']): BBox | undefined {
  const ring = extent?.coordinates?.[0]
  if (!ring?.length) return undefined
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** Regroupe les offres (une par protocole) d'une même couche en un `Dataset`. */
export function groupDocuments(documents: IndexDocument[]): Dataset[] {
  const byLayer = new Map<string, IndexDocument[]>()
  for (const d of documents) {
    if (!d.layer_name || !d.type) continue
    byLayer.set(d.layer_name, [...(byLayer.get(d.layer_name) ?? []), d])
  }
  return [...byLayer].flatMap(([layer, docs]) => {
    const services: ServiceAccess[] = []
    for (const d of docs) {
      const kind = KINDS[d.type]
      if (!kind || !/^https?:\/\//.test(d.url)) continue
      const endpoint = stripQuery(d.url).replace(/\/$/, '')
      if (services.some((s) => s.kind === kind && s.endpoint === endpoint)) continue
      services.push({
        kind,
        endpoint,
        capabilitiesUrl: capabilitiesUrl(kind, endpoint),
        layer,
        restricted: d.open === false || undefined,
      })
    }
    if (services.length === 0) return []
    const first = docs.find((d) => d.title) ?? docs[0]
    const extent = extentBBox(first.extent)
    return [
      {
        id: `index:${layer}`,
        source: 'index' as const,
        title: first.title || layer,
        abstract: first.description,
        producer: first.producers?.[0] ?? first.attribution?.title,
        type: 'Couche publiée',
        updatedAt: first.publication_date,
        license: first.licence,
        extents: extent ? [extent] : [],
        downloads: [],
        services,
        documentation: (first.metadata_urls ?? []).map((url) => ({ title: 'Métadonnées', url })),
        keywords: first.keywords,
        contacts: first.attribution
          ? [{ organisation: first.attribution.title, email: cleanEmail(first.attribution.email), website: /^https?:\/\//.test(first.attribution.url ?? '') ? first.attribution.url : undefined }]
          : [],
        theme: first.theme,
        thumbnail: first.thumbnail,
      },
    ]
  })
}

async function query(criteria: Record<string, unknown>, size: number, options: RequestOptions): Promise<IndexDocument[]> {
  const response = await fetchJson<{ documents?: IndexDocument[] }>(`${SEARCH_INDEX_URL}?page=1&size=${size}`, {
    ...options,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(criteria),
    },
  })
  if (!Array.isArray(response.documents)) throw new Error('Réponse de l’index de recherche inattendue.')
  return response.documents
}

/** Poids d'un terme selon son origine, puis du champ où il est trouvé (titre > mots-clés > description). */
const FIELD_WEIGHTS: [field: string, weight: number][] = [['title', 1], ['keywords', 0.7], ['description', 0.4]]
const MAX_TERMS = 4

export interface IndexTerm {
  term: string
  weight: number
  /** Besoin du thésaurus à l'origine du terme (pour expliquer le résultat). */
  concept?: string
}

/** Termes interrogés dans l'index : la saisie utile, puis les termes des besoins reconnus. */
export function indexTerms(a: Analysis): IndexTerm[] {
  const terms: IndexTerm[] = []
  const add = (t: IndexTerm) => !terms.some((x) => fold(x.term) === fold(t.term)) && terms.push(t)
  // La saisie brute pèse peu quand un besoin est reconnu : la recherche par titre de l'index est floue et bruyante.
  if (a.phrase) add({ term: a.phrase, weight: a.concepts.length ? 3 : 8 })
  for (const c of a.concepts) for (const term of c.indexTerms) add({ term, weight: 5, concept: c.label })
  if (!a.concepts.length) a.tokens.filter((t) => t.length > 3).slice(0, 2).forEach((term) => add({ term, weight: 4 }))
  return terms.slice(0, MAX_TERMS)
}

export async function searchIndex(input: string | Analysis, options: RequestOptions & { size?: number } = {}): Promise<Dataset[]> {
  const { size = 20, ...rest } = options
  const a = typeof input === 'string' ? analyze(input) : input
  const terms = indexTerms(a)
  if (!terms.length) return []

  const calls = terms.flatMap((t) => FIELD_WEIGHTS.map(([field, w]) => ({ t, field, w })))
  const results = await Promise.allSettled(calls.map((c) => query({ [c.field]: c.t.term }, size, rest)))
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed.length === results.length) throw failed[0].reason
  // Une annulation volontaire n'est pas un échec partiel : on la propage.
  const aborted = failed.find((f) => (f.reason as { kind?: string })?.kind === 'aborted')
  if (aborted) throw aborted.reason

  const best = new Map<string, { doc: IndexDocument; score: number; reason?: string }>()
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return
    const { t, w } = calls[i]
    for (const doc of r.value) {
      const score = t.weight * w
      const prev = best.get(doc.id)
      if (!prev || score > prev.score) best.set(doc.id, { doc, score, reason: t.concept ? `Besoin « ${t.concept} »` : undefined })
    }
  })
  const datasets = groupDocuments([...best.values()].map((b) => b.doc))
  const byLayer = new Map<string, { score: number; reason?: string }>()
  for (const { doc, score, reason } of best.values()) {
    const prev = byLayer.get(doc.layer_name)
    if (!prev || score > prev.score) byLayer.set(doc.layer_name, { score, reason })
  }
  return datasets
    .map((d) => ({ ...d, relevance: byLayer.get(d.id.replace(/^index:/, ""))?.score, matchReason: byLayer.get(d.id.replace(/^index:/, ""))?.reason }))
    .sort((x, y) => (y.relevance ?? 0) - (x.relevance ?? 0))
}

/** Couches de l'index à partir de leur nom exact (hydratation des résultats sémantiques). */
export async function getIndexLayers(layerNames: string[], options: RequestOptions = {}): Promise<Dataset[]> {
  const results = await Promise.allSettled(layerNames.map((name) => query({ layer_name: name }, 10, options)))
  const docs = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  // `layer_name` est un filtre approximatif : on ne garde que les couches demandées.
  return groupDocuments(docs.filter((d) => layerNames.includes(d.layer_name)))
}
