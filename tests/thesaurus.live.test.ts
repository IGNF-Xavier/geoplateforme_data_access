/**
 * TEST « LIVE » : interroge le vrai catalogue de la Géoplateforme. Il vérifie que chaque
 * produit et chaque thème INSPIRE du thésaurus existe encore (sinon le thésaurus doit être
 * mis à jour). Désactivé par défaut ; lancer avec : npm run test:live
 */
import { describe, expect, it } from 'vitest'
import { CATALOGUE_URL } from '../src/api/catalogue'
import { CONCEPTS } from '../src/search/thesaurus'

const live = process.env.LIVE === '1'
const post = async (query: unknown) => {
  const r = await fetch(CATALOGUE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Language': 'fr' },
    body: JSON.stringify({ size: 0, query }),
  })
  return ((await r.json()) as { hits: { total: { value: number } } }).hits.total.value
}

describe.skipIf(!live)('thésaurus de besoins vs catalogue réel', () => {
  for (const c of CONCEPTS) {
    it(`${c.id} : produits et thèmes existent`, async () => {
      for (const p of c.products) {
        expect(await post({ match_phrase: { 'resourceTitleObject.default': p } }), `produit « ${p} »`).toBeGreaterThan(0)
      }
      for (const t of c.themes) {
        expect(await post({ term: { inspireTheme: t } }), `thème « ${t} »`).toBeGreaterThan(0)
      }
    }, 30_000)
  }
})
