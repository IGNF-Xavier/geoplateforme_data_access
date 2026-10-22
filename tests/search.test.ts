import { describe, expect, it } from 'vitest'
import { buildSearchBody, parseCatalogueResponse, parseRecord } from '../src/api/catalogue'
import { indexTerms } from '../src/api/searchIndex'
import { analyze, fold, singular, withinOneEdit } from '../src/search/analyze'
import { CONCEPTS } from '../src/search/thesaurus'
import { checkCoverage } from '../src/services/coverage'
import { rank, scoreCatalogue } from '../src/services/search'
import type { Dataset } from '../src/types'
import { bboxToPolygon, createArea } from '../src/utils/geo'
import { BDTOPO_RECORD, MINIMAL_RECORD } from './fixtures'

const ds = (over: Partial<Dataset>): Dataset => ({ ...parseRecord(MINIMAL_RECORD), ...over })
const ids = (q: string) => analyze(q).concepts.map((c) => c.id)

describe('analyse d’une requête en langage courant', () => {
  it('normalise accents, casse, pluriels', () => {
    expect(fold('Bâtiments & Forêts !')).toBe('batiments forets')
    expect(singular('batiments')).toBe('batiment')
    expect(singular('eaux')).toBe('eau')
    expect(singular('animaux')).toBe('animal')
    expect(analyze('Les BÂTIMENTS').phrase).toBe('batiment')
  })

  it('retire les mots d’amorce', () => {
    expect(analyze("Je cherche les données sur l'altitude").phrase).toBe('altitude')
    expect(analyze('je voudrais trouver des photos aériennes').tokens).toEqual(['photo', 'aerienne'])
    expect(analyze('commune').phrase).toBe('commune') // un mot d’amorce seul est conservé
  })

  it('reconnaît les besoins, avec pluriels, expressions et fautes de frappe', () => {
    expect(ids('bâtiments')).toEqual(['batiments'])
    expect(ids('batiements')).toEqual(['batiments']) // faute de frappe
    expect(ids('photos aériennes')).toContain('photos')
    expect(ids('je cherche des rivières')).toContain('eau')
    expect(ids('cours d’eau')).toContain('eau')
    expect(ids('altitude du terrain')).toContain('relief')
    expect(ids('risque d’inondation')).toContain('risques')
    expect(ids('espèces protégées')).toContain('biodiversite')
    expect(ids('mnhn')).toContain('biodiversite')
    expect(ids('BD TOPO')).toEqual([]) // un nom de produit n’est pas un besoin
    expect(ids('zzzzqq')).toEqual([])
  })

  it('plusieurs besoins dans une même demande', () => {
    expect(ids('routes de ma commune')).toEqual(['routes', 'limites'])
  })

  it('distance d’édition', () => {
    expect(withinOneEdit('batiment', 'batiement')).toBe(true)
    expect(withinOneEdit('batiment', 'batimnet')).toBe(true) // transposition
    expect(withinOneEdit('batiment', 'bateau')).toBe(false)
  })
})

describe('thésaurus', () => {
  it('chaque besoin est exploitable (déclencheurs, et au moins un produit, thème ou terme d’index)', () => {
    const seen = new Set<string>()
    for (const c of CONCEPTS) {
      expect(seen.has(c.id), `doublon ${c.id}`).toBe(false)
      seen.add(c.id)
      expect(c.triggers.length, c.id).toBeGreaterThan(0)
      expect(c.products.length + c.themes.length + c.indexTerms.length, c.id).toBeGreaterThan(0)
      for (const t of c.triggers) expect(fold(t), `${c.id}: « ${t} » doit être sans accent ni majuscule`).toBe(t)
    }
  })

  it('chaque besoin se reconnaît par son premier déclencheur', () => {
    for (const c of CONCEPTS) expect(ids(c.triggers[0]), c.id).toContain(c.id)
  })
})

describe('requêtes envoyées', () => {
  const should = (q: string) => (buildSearchBody(q, 20).query as { bool: { should: Record<string, unknown>[] } }).bool.should

  it('saisie vide : tout le catalogue', () => {
    expect(buildSearchBody('  ', 20).query).toEqual({ match_all: {} })
  })

  it('un besoin reconnu ajoute produits (×10) et thèmes INSPIRE (×3) et exclut le résumé du flou', () => {
    const s = should('bâtiments')
    expect(JSON.stringify(s)).toContain('"query":"BD TOPO","boost":10')
    expect(s.some((c) => 'terms' in c && JSON.stringify(c).includes('buildings'))).toBe(true)
    const fuzzy = s.find((c) => JSON.stringify(c).includes('fuzziness')) as { multi_match: { fields: string[] } }
    expect(fuzzy.multi_match.fields.join()).not.toContain('Abstract')
  })

  it('sans besoin reconnu : correspondance floue aussi sur le résumé, pas de produits', () => {
    const s = should('lapin géant')
    expect(JSON.stringify(s)).not.toContain('"boost":10')
    expect(JSON.stringify(s)).toContain('resourceAbstractObject')
  })

  it('termes de l’index : saisie légère si besoin reconnu, au plus 4 termes', () => {
    const t = indexTerms(analyze('espèces protégées'))
    expect(t.length).toBeLessThanOrEqual(4)
    expect(t[0].weight).toBe(3)
    expect(t.some((x) => x.term === 'Patrinat' && x.concept)).toBe(true)
    expect(indexTerms(analyze('BD TOPO'))[0].weight).toBe(8)
    expect(indexTerms(analyze(' '))).toEqual([])
  })
})

describe('pertinence', () => {
  const analysis = analyze('bâtiments')
  const bd = ds({ id: 'a', title: 'BD TOPO®', relevance: 5 })
  const other = ds({ id: 'b', title: 'Points noirs de bruit', relevance: 6 })
  const themed = ds({ id: 'c', title: 'Autre jeu', relevance: 5, inspireThemes: ['buildings'] })

  it('un produit de référence passe avant un meilleur score brut', () => {
    const ranked = rank(scoreCatalogue([other, themed, bd], analysis))
    expect(ranked.map((d) => d.id)).toEqual(['a', 'c', 'b'])
    expect(ranked[0].matchReason).toContain('Bâtiments')
    expect(ranked[1].matchReason).toContain('Thème')
    expect(ranked[2].matchReason).toBeUndefined()
  })

  it('le nom saisi l’emporte sur tout besoin déduit (« BD TOPO » → BD TOPO avant Plan IGN)', () => {
    const r = rank(scoreCatalogue([ds({ id: 'plan', title: 'Plan IGN', relevance: 9 }), ds({ id: 'bd', title: 'BD TOPO® Historique', relevance: 4 })], analyze('BD TOPO')))
    expect(r[0].id).toBe('bd')
    expect(r[0].matchReason).toBe('Correspond au nom recherché')
  })

  it('un besoin générique (cartes) s’efface devant un besoin précis (anciennes)', () => {
    const r = rank(
      scoreCatalogue(
        [ds({ id: 'plan', title: 'Plan IGN', relevance: 9 }), ds({ id: 'cassini', title: 'Carte de Cassini', relevance: 7 }), ds({ id: 'em', title: 'SCAN Etat-Major® 40k', relevance: 7 })],
        analyze('cartes anciennes'),
      ),
    )
    expect(r[0].id).not.toBe('plan')
  })

  it('à pertinence égale, le catalogue passe avant l’index', () => {
    const r = rank([ds({ id: 'i', source: 'index', relevance: 5 }), ds({ id: 'c', source: 'catalogue', relevance: 5 })])
    expect(r.map((d) => d.id)).toEqual(['c', 'i'])
  })

  it('le score Elasticsearch et les thèmes INSPIRE sont lus dans la réponse du catalogue', () => {
    const r = parseCatalogueResponse({ hits: { total: { value: 1 }, hits: [{ _score: 7.5, _source: { ...BDTOPO_RECORD, inspireTheme: ['buildings', 'elevation'] } }] } })
    expect(r.datasets[0].relevance).toBe(7.5)
    expect(r.datasets[0].inspireThemes).toEqual(['buildings', 'elevation'])
  })
})

describe('couverture d’une zone (la zone est facultative, elle sert à vérifier)', () => {
  const area = (bbox: [number, number, number, number]) => createArea(bboxToPolygon(bbox), 'rectangle', 'z')
  const france = ds({ extents: [[-5.15, 41.32, 9.57, 51.1], [-61.82, 15.82, -60.99, 16.55]] })

  it('couverte / hors emprise, d’après la fiche', () => {
    expect(checkCoverage(area([2.4, 48.8, 2.5, 48.9]), france).status).toBe('covered')
    expect(checkCoverage(area([139, 35, 140, 36]), france).status).toBe('outside')
    expect(checkCoverage(area([-61.5, 16, -61.4, 16.1]), france).status).toBe('covered') // un DOM déclaré
  })

  it('l’emprise annoncée par le service est prioritaire sur la fiche', () => {
    const c = checkCoverage(area([2.4, 48.8, 2.5, 48.9]), france, [10, 40, 12, 42])
    expect(c.status).toBe('outside')
    expect(c.text).toContain('service')
  })

  it('emprise absente : on ne prétend pas savoir', () => {
    expect(checkCoverage(area([2.4, 48.8, 2.5, 48.9]), ds({ extents: [] })).status).toBe('unknown')
  })

  it('bordure : contact exact avec l’emprise = couvert', () => {
    expect(checkCoverage(area([9.57, 45, 10, 46]), france).status).toBe('covered')
  })
})
