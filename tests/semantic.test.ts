import { afterEach, describe, expect, it, vi } from 'vitest'
import { SemanticSearch, decodeVectors, topK, type SemanticHit, type SemanticIndex } from '../src/search/semantic'
import { SEMANTIC, applySemantic, searchAll, selectSemanticHits, semanticBonus } from '../src/services/search'
import { parseRecord } from '../src/api/catalogue'
import type { Dataset } from '../src/types'
import { BDTOPO_RECORD, MINIMAL_RECORD } from './fixtures'

/** Vecteurs de TEST : 3 dimensions, normalisés, quantifiés sur 8 bits comme dans l'index réel. */
const q = (v: number[]) => v.map((x) => Math.round(x * 127))
const b64 = (ints: number[]) => btoa(String.fromCharCode(...new Uint8Array(Int8Array.from(ints).buffer)))
const INDEX: SemanticIndex = {
  model: 'test',
  dim: 3,
  scale: 127,
  items: [
    { id: 'u-ortho', src: 'c', title: 'BD ORTHO' },
    { id: 'u-alti', src: 'c', title: 'RGE ALTI' },
    { id: 'couche_x', src: 'i', title: 'Couche X' },
  ],
  vectors: b64([...q([1, 0, 0]), ...q([0, 1, 0]), ...q([0.8, 0.6, 0])]),
}

const hit = (over: Partial<SemanticHit>): SemanticHit => ({ id: 'u-ortho', src: 'c', title: 'BD ORTHO', sim: 0.9, ...over })
const ds = (over: Partial<Dataset>): Dataset => ({ ...parseRecord(MINIMAL_RECORD), ...over })
const json = (b: unknown) => new Response(JSON.stringify(b))

afterEach(() => vi.unstubAllGlobals())

describe('index sémantique', () => {
  it('décode les entiers 8 bits signés', () => {
    expect(Array.from(decodeVectors(b64([127, -127, 0, -1, 5])))).toEqual([127, -127, 0, -1, 5])
  })

  it('classe par similarité cosinus décroissante', () => {
    const hits = topK([1, 0, 0], INDEX, decodeVectors(INDEX.vectors), 3)
    expect(hits.map((h) => h.id)).toEqual(['u-ortho', 'couche_x', 'u-alti'])
    expect(hits[0].sim).toBeCloseTo(1, 1)
    expect(hits[1].sim).toBeCloseTo(0.8, 1)
    expect(hits[2].sim).toBeCloseTo(0, 1)
    expect(topK([1, 0, 0], INDEX, decodeVectors(INDEX.vectors), 1)).toHaveLength(1)
  })

  it('refuse une dimension incompatible (modèle différent de celui de l’index)', () => {
    expect(() => topK([1, 0], INDEX, decodeVectors(INDEX.vectors), 3)).toThrow(/Dimension/)
  })
})

describe('SemanticSearch (vectoriseur injecté)', () => {
  const make = (embed = async () => Float32Array.from([1, 0, 0]), loadIndex = async () => INDEX) =>
    new SemanticSearch({ loadIndex, createEmbedder: async (onProgress) => (onProgress({ percent: 50, label: 'x' }), embed) })

  it('passe de off à loading puis ready, et notifie', async () => {
    const s = make()
    const seen: string[] = []
    s.subscribe(() => seen.push(s.status))
    expect(s.status).toBe('off')
    await s.enable()
    expect(s.status).toBe('ready')
    expect(seen).toContain('loading')
    expect(seen.at(-1)).toBe('ready')
    expect((await s.search('photos aériennes', 2))[0].id).toBe('u-ortho')
  })

  it('préfixe la requête pour le modèle e5 et ignore une saisie vide', async () => {
    const embed = vi.fn(async () => Float32Array.from([1, 0, 0]))
    const s = make(embed)
    await s.enable()
    await s.search('  maisons ')
    expect(embed).toHaveBeenCalledWith('query: maisons')
    expect(await s.search('   ')).toEqual([])
  })

  it('ne lève pas d’exception si le chargement échoue : état error, recherche vide, nouvel essai possible', async () => {
    let fail = true
    const s = make(undefined, async () => {
      if (fail) throw new Error('réseau')
      return INDEX
    })
    await s.enable()
    expect(s.status).toBe('error')
    expect(s.error).toBe('réseau')
    expect(await s.search('x')).toEqual([])
    fail = false
    await s.enable()
    expect(s.status).toBe('ready')
  })

  it('ne charge qu’une fois', async () => {
    const loadIndex = vi.fn(async () => INDEX)
    const s = make(undefined, loadIndex)
    await Promise.all([s.enable(), s.enable()])
    expect(loadIndex).toHaveBeenCalledTimes(1)
  })

  it('sans activation, la recherche renvoie une liste vide', async () => {
    expect(await make().search('x')).toEqual([])
  })
})

describe('fusion sémantique : sélection et bonus', () => {
  it('garde les résultats proches du meilleur et au-dessus du plancher', () => {
    const hits = [hit({ sim: 0.95 }), hit({ id: 'b', sim: 0.92 }), hit({ id: 'c', sim: 0.89 }), hit({ id: 'd', sim: 0.85 })]
    expect(selectSemanticHits(hits).map((h) => h.id)).toEqual(['u-ortho', 'b']) // c est hors fenêtre (0,06 > 0,05), d sous le plancher
    expect(selectSemanticHits([hit({ sim: 0.87 })])).toEqual([]) // sous le plancher absolu : aucune réponse « proche » // sous le plancher absolu : aucune réponse « proche »
    expect(selectSemanticHits([])).toEqual([])
  })

  it('bonus maximal pour le meilleur, décroissant, réduit pour une couche de l’index', () => {
    const best = hit({ sim: 0.9 })
    expect(semanticBonus(best, 0.9)).toBe(SEMANTIC.weight)
    expect(semanticBonus(hit({ sim: 0.9 - SEMANTIC.window / 2 }), 0.9)).toBeCloseTo(SEMANTIC.weight / 2)
    expect(semanticBonus(hit({ sim: 0.5 }), 0.9)).toBe(0)
    expect(semanticBonus(hit({ src: 'i' }), 0.9)).toBeCloseTo(SEMANTIC.weight * SEMANTIC.indexFactor)
  })
})

describe('fusion sémantique : résultats', () => {
  const lexical = [ds({ id: 'u-ortho', title: 'BD ORTHO', relevance: 5 }), ds({ id: 'autre', title: 'Autre', relevance: 5 })]

  it('remonte une donnée déjà présente et indique pourquoi', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const r = await applySemantic(lexical, [hit({ sim: 0.9 })])
    expect(r.boosted).toBe(1)
    expect(r.added).toBe(0)
    expect(r.datasets[0].relevance).toBe(5 + SEMANTIC.weight)
    expect(r.datasets[0].matchReason).toBe('Sens proche de votre recherche')
    expect(r.datasets[1].relevance).toBe(5) // inchangé
    expect(lexical[0].relevance).toBe(5) // les entrées ne sont pas modifiées en place
  })

  it('ajoute une fiche du catalogue et une couche de l’index absentes de la liste lexicale (hydratation)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/catalog/')) return json({ hits: { total: { value: 1 }, hits: [{ _source: { ...BDTOPO_RECORD, uuid: 'u-alti' } }] } })
      const body = JSON.parse(String(init.body))
      return json({ documents: body.layer_name === 'couche_x' ? [{ id: 'd', layer_name: 'couche_x', title: 'Couche X', type: 'WMS', url: 'https://data.geopf.fr/wms-v?x=1', open: true }] : [] })
    }))
    const r = await applySemantic(lexical, [hit({ sim: 0.9 }), hit({ id: 'u-alti', title: 'RGE ALTI', sim: 0.89 }), hit({ id: 'couche_x', src: 'i', title: 'Couche X', sim: 0.9 })])
    expect(r.added).toBe(2)
    expect(r.datasets.map((d) => d.id)).toEqual(['u-ortho', 'autre', 'u-alti', 'index:couche_x'])
    expect(r.datasets.slice(2).every((d) => d.matchReason === 'Sens proche de votre recherche')).toBe(true)
  })

  it('une hydratation en échec est ignorée : le résultat lexical reste intact', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    const r = await applySemantic(lexical, [hit({ id: 'inconnu', sim: 0.9 })])
    expect(r.added).toBe(0)
    expect(r.datasets.map((d) => d.id)).toEqual(['u-ortho', 'autre'])
  })

  it('aucun résultat sémantique retenu : liste inchangée, sans appel réseau', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const r = await applySemantic(lexical, [hit({ sim: 0.5 })])
    expect(r.datasets).toBe(lexical)
    expect(f).not.toHaveBeenCalled()
  })

  it('searchAll : sans résultats sémantiques, comportement lexical inchangé', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('/catalog/') ? json({ hits: { total: { value: 1 }, hits: [{ _score: 3, _source: BDTOPO_RECORD }] } }) : json({ documents: [] }),
    ))
    const r = await searchAll('BD TOPO')
    expect(r.semantic).toEqual({ used: false, added: 0, boosted: 0 })
    expect(r.datasets[0].id).toBe('IGNF_BD-TOPO')
  })

  it('searchAll : un résultat sémantique est remonté et compté', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('/catalog/') ? json({ hits: { total: { value: 1 }, hits: [{ _score: 3, _source: BDTOPO_RECORD }] } }) : json({ documents: [] }),
    ))
    const r = await searchAll('maisons', { semanticHits: [hit({ id: 'IGNF_BD-TOPO', title: 'BD TOPO', sim: 0.9 })] })
    expect(r.semantic).toEqual({ used: true, added: 0, boosted: 1 })
    expect(r.datasets[0].matchReason).toBeTruthy()
  })
})
