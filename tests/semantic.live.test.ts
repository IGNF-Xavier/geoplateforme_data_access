/**
 * ÉVALUATION « LIVE » de la recherche : compare lexical seul, sémantique seul et hybride sur
 * des formulations en langage courant, contre le VRAI catalogue. Sert à calibrer SEMANTIC
 * (services/search.ts) et à détecter une régression.
 *
 * Prérequis : modèle dans ./.models/ et public/semantic/index.json (scripts/build-semantic-index.mjs).
 * Lancer : npm run test:semantic   (rapport : eval-report.txt)
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { env, pipeline } from '@huggingface/transformers'
import { describe, expect, it } from 'vitest'
import { SemanticSearch, type SemanticIndex } from '../src/search/semantic'
import { SEMANTIC, applySemantic, rank, searchAll, selectSemanticHits } from '../src/services/search'
import type { Dataset } from '../src/types'

const live = process.env.LIVE === '1'

/** [requête en langage courant, expression que doit contenir le titre d'une bonne réponse] */
export const EVAL: [string, RegExp][] = [
  ['maisons et immeubles', /BD TOPO|b[aâ]timent/i],
  ['photos prises d’avion', /ORTHO/i],
  ['hauteur du sol', /ALTI|RELIEF|MNT|Courbes/i],
  ['limites des propriétés', /PARCELL|Cadastre/i],
  ['bois et arbres', /For[eê]t|HAIE|Arbre/i],
  ['où sont les rivières', /hydro|cours d.eau|Masses d.eau|CARTHAGE|BD TOPO/i],
  ['cartes du XVIIIe siècle', /Cassini|Etat-Major/i],
  ['zones inondables', /inondation|PPRI|TRI|Risque/i],
  ['espaces naturels protégés', /Patrinat|prot[eé]g|Natura|Parc|r[eé]serve/i],
  ['lignes électriques et éoliennes', /ENR|[eé]olien|[eé]lectri/i],
  ['numéros dans les rues', /ADRESSE|BAN/i],
  ['à quoi sert le sol : urbain, agricole, forêt', /OCS|CORINE|COSIA|occupation/i],
  ['cultures agricoles déclarées', /RPG|agricole|parcellaire graphique/i],
  ['limites des communes et départements', /ADMIN EXPRESS|GEOFLA|Limites|communes/i],
  ['nuage de points en 3D', /LiDAR|nuage|MNH/i],
  ['règles d’urbanisme et servitudes', /urbanisme|PLU|servitude|SUP/i],
  ['stations de recharge pour voitures électriques', /IRVE|recharge|bornes/i],
  ['nature des roches et du sous-sol', /g[eé]olog|sols?\b/i],
  ['carte papier de randonnée', /SCAN|Plan IGN|carte/i],
  ['images satellites de la France', /ORTHO|SAT|satellite/i],
  ['voies ferrées et gares', /ferr|gare|TRANSPORT|BD TOPO/i],
  ['courbes de niveau et pente du terrain', /ALTI|RELIEF|Courbes|MNT/i],
  ['quartiers et statistiques de population', /IRIS|INSEE|population/i],
  ['trait de côte et littoral', /c[oô]te|littoral|maritime/i],
  ['zones où les drones sont interdits', /UAS|drone|ZICAD|a[eé]ronef/i],
  ['anciennes photos aériennes', /PVA|historique|ancien|ORTHO|Remonter/i],
  ['parcelles du cadastre', /PARCELL|Cadastre|PCI/i],
  ['hauteur des bâtiments', /BD TOPO|b[aâ]timent/i],
  ['les routes et chemins', /ROUTE|VOIRIE|BD TOPO|TRANSPORT/i],
  ['cours d’eau et zones humides', /humides|cours d.eau|hydro|Masses d.eau/i],
]

/** Requêtes SANS bonne réponse dans les données : la recherche sémantique ne doit rien « remonter ». */
export const NEGATIVE = ['recette de gâteau au chocolat', 'résultats du championnat de football', 'météo de demain à Lyon', 'stations de recharge pour voitures électriques', 'horaires des trains', 'prix de l’immobilier']

const rankOf = (list: { title: string }[], re: RegExp, n = 10) => {
  const i = list.slice(0, n).findIndex((d) => re.test(d.title))
  return i < 0 ? 0 : 1 / (i + 1)
}

describe.skipIf(!live)('recherche : lexical vs sémantique vs hybride (catalogue réel)', () => {
  it('rapport d’évaluation', async () => {
    const f = globalThis.fetch
    globalThis.fetch = ((u: string, i: RequestInit = {}) => f(u, { ...i, headers: { ...(i.headers as object), 'Accept-Language': 'fr' } })) as typeof fetch

    env.allowLocalModels = true
    env.localModelPath = './.models/'
    env.allowRemoteModels = false
    const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8' })
    const index = JSON.parse(readFileSync('public/semantic/index.json', 'utf8')) as SemanticIndex
    const semantic = new SemanticSearch({
      loadIndex: async () => index,
      createEmbedder: async () => async (text) => Float32Array.from((await extractor(text, { pooling: 'mean', normalize: true })).data as Float32Array),
    })
    await semantic.enable()

    // Balayage des réglages : lexical et vecteurs calculés une fois, réglages variés ensuite.
    const cache = new Map<string, Promise<{ status: number; text: string }>>()
    const raw = globalThis.fetch
    globalThis.fetch = (async (u: string, i: RequestInit = {}) => {
      const key = `${u}|${i.body ?? ''}`
      if (!cache.has(key)) cache.set(key, raw(u, i).then(async (r) => ({ status: r.status, text: await r.text() })))
      const { status, text } = await cache.get(key)!
      return new Response(text, { status })
    }) as typeof fetch
    const log = (s: string) => appendFileSync('eval-progress.txt', `${new Date().toISOString().slice(11, 19)} ${s}\n`)
    writeFileSync('eval-progress.txt', '')
    const prepared = []
    for (const [q, re] of EVAL) {
      prepared.push({ q, re, hits: await semantic.search(q, 12), base: (await searchAll(q, { size: 20 })).datasets })
      log(`préparé : ${q}`)
    }
    const results: { cfg: string; ok: number; mrr: number }[] = []
    const saved = { ...SEMANTIC }
    const negHits = []
    for (const q of NEGATIVE) negHits.push(await semantic.search(q, 12))
    for (const weight of [8, 12, 16]) {
      for (const window of [0.03, 0.05, 0.08]) {
        for (const floor of [0.8, 0.84, 0.86, 0.88, 0.9]) {
          Object.assign(SEMANTIC, { weight, window, floor })
          let ok = 0
          let mrr = 0
          for (const p of prepared) {
            const fused = rank((await applySemantic(p.base, p.hits)).datasets)
            const r = rankOf(fused, p.re, 5)
            ok += r > 0 ? 1 : 0
            mrr += r
          }
          log(`balayage ${weight}/${window}/${floor}`)
          const falsePositives = negHits.filter((h) => selectSemanticHits(h).length > 0).length
          results.push({ cfg: `poids ${weight} fenêtre ${window} plancher ${floor} faux positifs ${falsePositives}/${NEGATIVE.length}`, ok, mrr: mrr / EVAL.length })
        }
      }
    }
    Object.assign(SEMANTIC, saved)
    results.sort((a, b) => b.mrr - a.mrr || b.ok - a.ok)
    writeFileSync('eval-sweep.txt', results.map((r) => `${r.cfg} : succès@5 ${r.ok}/${EVAL.length}, MRR@5 ${r.mrr.toFixed(3)}`).join('\n'))
    globalThis.fetch = raw

    const lines: string[] = []
    const sums = { lex: [0, 0], sem: [0, 0], hyb: [0, 0] }
    for (const [q, re] of EVAL) {
      const hits = await semantic.search(q, 12)
      const lexical = (await searchAll(q, { size: 20 })).datasets
      const hybrid = (await searchAll(q, { size: 20, semanticHits: hits })).datasets
      const r = { lex: rankOf(lexical, re, 5), sem: rankOf(hits, re, 5), hyb: rankOf(hybrid, re, 5) }
      for (const k of ['lex', 'sem', 'hyb'] as const) {
        sums[k][0] += r[k] > 0 ? 1 : 0
        sums[k][1] += r[k]
      }
      const top = (l: Dataset[] | { title: string }[]) => l.slice(0, 3).map((d) => d.title.slice(0, 28)).join(' ; ')
      lines.push(`${q}\n   lex ${r.lex.toFixed(2)} [${top(lexical)}]\n   sem ${r.sem.toFixed(2)} [${top(hits)}] (${hits.map((h) => h.sim.toFixed(2)).slice(0, 3).join(' ')})\n   hyb ${r.hyb.toFixed(2)} [${top(hybrid)}]`)
    }
    const n = EVAL.length
    const summary = (['lex', 'sem', 'hyb'] as const).map((k) => `${k}: succès@5 ${sums[k][0]}/${n}, MRR@5 ${(sums[k][1] / n).toFixed(3)}`).join(' | ')
    writeFileSync('eval-report.txt', `${summary}\n\n${lines.join('\n')}\n`)
    globalThis.fetch = f
    expect(sums.hyb[0]).toBeGreaterThanOrEqual(sums.lex[0])
  }, 3_000_000)
})
