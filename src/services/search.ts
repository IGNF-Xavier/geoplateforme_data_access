import { getDatasetsByIds, searchDatasets as searchCatalogue } from '../api/catalogue'
import type { RequestOptions } from '../api/http'
import { getIndexLayers, searchIndex } from '../api/searchIndex'
import { analyze, fold, singular, type Analysis } from '../search/analyze'
import type { SemanticHit } from '../search/semantic'
import type { Dataset } from '../types'

export interface SearchOutcome {
  datasets: Dataset[]
  /** Ce qui a été compris de la saisie (besoins reconnus, mots retenus). */
  analysis: Analysis
  /** Nombre de résultats du catalogue (total côté serveur). */
  catalogueTotal: number
  /** Nombre de couches supplémentaires venant de l'index de recherche. */
  indexCount: number
  /** Recherche sémantique : utilisée ou non, et nombre de données qu'elle a ajoutées ou remontées. */
  semantic: { used: boolean; added: number; boosted: number }
  /** Sources en échec : le résultat est alors partiel. */
  failures: { source: 'catalogue' | 'index'; message: string }[]
}

/**
 * Ajoute à la liste du catalogue les couches de l'index qui n'y figurent pas déjà :
 * une couche de l'index est écartée si son nom de couche est publié par une fiche du
 * catalogue (même donnée, vue sous deux angles).
 */
export function mergeDatasets(catalogue: Dataset[], index: Dataset[]): Dataset[] {
  const known = new Set(catalogue.flatMap((d) => d.services.map((s) => s.layer)))
  return [...catalogue, ...index.filter((d) => !d.services.some((s) => known.has(s.layer)))]
}

/**
 * Score des fiches du catalogue : score Elasticsearch ramené sur 1–10, plus un bonus
 * quand la fiche est un produit de référence du besoin reconnu (+10) ou porte un thème
 * INSPIRE de ce besoin (+3). Fixe aussi la raison affichée à l'utilisateur.
 */
export function scoreCatalogue(datasets: Dataset[], analysis: Analysis): Dataset[] {
  const max = Math.max(1, ...datasets.map((d) => d.relevance ?? 0))
  return datasets.map((d) => {
    let relevance = 1 + (9 * (d.relevance ?? 0)) / max
    let matchReason: string | undefined
    const title = fold(d.title)
    // Le nom saisi (« BD TOPO ») l'emporte sur tout besoin déduit : mots de la saisie tous présents dans le titre.
    const titleWords = new Set(title.split(' ').map(singular))
    if (analysis.phrase.length >= 4 && analysis.tokens.every((w) => titleWords.has(w))) {
      relevance += 12
      matchReason = 'Correspond au nom recherché'
    }
    const specific = analysis.concepts.some((c) => !c.generic)
    for (const c of analysis.concepts) {
      if (c.products.some((p) => title.includes(fold(p)))) {
        relevance += c.generic && specific ? 3 : 10
        matchReason ??= `Produit de référence — ${c.label}`
        break
      }
      if (d.inspireThemes?.some((t) => c.themes.includes(t))) {
        relevance += 3
        matchReason ??= `Thème — ${c.label}`
      }
    }
    return { ...d, relevance, matchReason }
  })
}

/** Classe par pertinence décroissante ; à égalité, le catalogue avant l'index puis l'ordre d'origine. */
export function rank(datasets: Dataset[]): Dataset[] {
  return datasets
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (b.d.relevance ?? 0) - (a.d.relevance ?? 0) || (a.d.source === b.d.source ? 0 : a.d.source === 'catalogue' ? -1 : 1) || a.i - b.i)
    .map((x) => x.d)
}

/**
 * Réglages de la fusion sémantique. Valeurs calibrées sur le jeu d'évaluation de
 * tests/semantic.live.test.ts (scores cosinus de multilingual-e5-small : les formulations proches
 * se situent à 0,80–0,90, très serrés, d'où une fenêtre relative au meilleur résultat).
 */
export const SEMANTIC = {
  /** Similarité minimale absolue pour être retenu. */
  floor: 0.88,
  /** Écart maximal avec le meilleur résultat. */
  window: 0.05,
  /** Bonus maximal (comparable au bonus « produit de référence », 10). */
  weight: 12,
  /** Les couches de l'index (nombreuses, parfois des tests) pèsent moins que les fiches du catalogue. */
  indexFactor: 0.7,
}

export function selectSemanticHits(hits: SemanticHit[]): SemanticHit[] {
  if (!hits.length) return []
  const best = Math.max(...hits.map((h) => h.sim))
  return hits.filter((h) => h.sim >= SEMANTIC.floor && h.sim >= best - SEMANTIC.window)
}

export function semanticBonus(hit: SemanticHit, best: number): number {
  const closeness = 1 - Math.max(0, best - hit.sim) / SEMANTIC.window
  return SEMANTIC.weight * Math.max(0, closeness) * (hit.src === 'i' ? SEMANTIC.indexFactor : 1)
}

const keyOf = (h: SemanticHit) => (h.src === 'c' ? h.id : `index:${h.id}`)
const SEMANTIC_REASON = 'Sens proche de votre recherche'

/** Ajoute le bonus sémantique aux résultats lexicaux et complète avec les données absentes de la liste. */
export async function applySemantic(
  datasets: Dataset[],
  rawHits: SemanticHit[],
  options: RequestOptions = {},
): Promise<{ datasets: Dataset[]; added: number; boosted: number }> {
  const hits = selectSemanticHits(rawHits)
  if (!hits.length) return { datasets, added: 0, boosted: 0 }
  const best = Math.max(...hits.map((h) => h.sim))
  const byKey = new Map(datasets.map((d) => [d.id, d]))
  const out = datasets.map((d) => ({ ...d }))
  const outByKey = new Map(out.map((d) => [d.id, d]))
  let boosted = 0
  const missing: SemanticHit[] = []
  for (const h of hits) {
    const d = outByKey.get(keyOf(h))
    if (!d) {
      missing.push(h)
      continue
    }
    d.relevance = (d.relevance ?? 0) + semanticBonus(h, best)
    d.matchReason ??= SEMANTIC_REASON
    boosted += 1
  }
  void byKey
  const [cat, idx] = await Promise.allSettled([
    getDatasetsByIds(missing.filter((h) => h.src === 'c').map((h) => h.id), options),
    getIndexLayers(missing.filter((h) => h.src === 'i').map((h) => h.id), options),
  ])
  const hydrated = [...(cat.status === 'fulfilled' ? cat.value : []), ...(idx.status === 'fulfilled' ? idx.value : [])]
  let added = 0
  for (const d of hydrated) {
    const hit = missing.find((h) => keyOf(h) === d.id)
    if (!hit || outByKey.has(d.id)) continue
    out.push({ ...d, relevance: 1 + semanticBonus(hit, best), matchReason: SEMANTIC_REASON })
    added += 1
  }
  return { datasets: out, added, boosted }
}

export async function searchAll(
  query: string,
  options: RequestOptions & { size?: number; semanticHits?: SemanticHit[] } = {},
): Promise<SearchOutcome> {
  const { semanticHits = [], ...requestOptions } = options
  const analysis = analyze(query)
  const [cat, idx] = await Promise.allSettled([searchCatalogue(analysis, requestOptions), searchIndex(analysis, { ...requestOptions, size: 20 })])
  const failures: SearchOutcome['failures'] = []
  const reason = (r: PromiseRejectedResult) => (r.reason instanceof Error ? r.reason.message : String(r.reason))
  // Une annulation volontaire n'est pas un échec : on la propage.
  for (const r of [cat, idx]) {
    if (r.status === 'rejected' && (r.reason as { kind?: string })?.kind === 'aborted') throw r.reason
  }
  if (cat.status === 'rejected') failures.push({ source: 'catalogue', message: reason(cat) })
  if (idx.status === 'rejected') failures.push({ source: 'index', message: reason(idx) })
  if (cat.status === 'rejected' && idx.status === 'rejected') throw new Error(failures.map((f) => f.message)[0])

  const catalogue = cat.status === 'fulfilled' ? scoreCatalogue(cat.value.datasets, analysis) : []
  const index = idx.status === 'fulfilled' ? mergeDatasets(catalogue, idx.value).slice(catalogue.length) : []
  const lexical = [...catalogue, ...index]
  const fused = analysis.phrase && semanticHits.length ? await applySemantic(lexical, semanticHits, requestOptions) : { datasets: lexical, added: 0, boosted: 0 }
  return {
    // Sans saisie : l'ordre du catalogue est conservé (pas de pertinence à calculer).
    datasets: analysis.phrase ? rank(fused.datasets) : lexical,
    semantic: { used: semanticHits.length > 0, added: fused.added, boosted: fused.boosted },
    analysis,
    catalogueTotal: cat.status === 'fulfilled' ? cat.value.total : 0,
    indexCount: index.length,
    failures,
  }
}
