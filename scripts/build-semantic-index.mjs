/**
 * Génère l'index sémantique statique (public/semantic/index.json) : un vecteur par fiche du
 * catalogue GeoNetwork et par couche de l'index de recherche, calculé avec le MÊME modèle que
 * celui chargé dans le navigateur (multilingual-e5-small, quantifié).
 *
 * Usage : node scripts/build-semantic-index.mjs
 * Prérequis : le modèle dans ./.models/ (voir scripts/download-model.sh) — Node n'atteint pas
 * Hugging Face derrière certains proxys, d'où le téléchargement séparé (curl).
 * À relancer quand le catalogue change (cf. README).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { env, pipeline } from '@huggingface/transformers'

const MODEL = 'Xenova/multilingual-e5-small'
const CATALOGUE = 'https://data.geopf.fr/catalog/search/records/_search?bucket=bucket'
const INDEX = 'https://data.geopf.fr/recherche/api/indexes/geoplateforme'
const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Language': 'fr' }

env.localModelPath = './.models/'
env.allowRemoteModels = false

const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
  return r.json()
}

const clip = (s, n) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const text = (o) => o?.default ?? o?.langfre

async function catalogueItems() {
  const r = await post(CATALOGUE, {
    size: 1000,
    _source: ['uuid', 'resourceTitleObject', 'resourceAbstractObject', 'tag', 'inspireTheme_syn', 'cl_topic'],
    query: { match_all: {} },
  })
  return r.hits.hits.map((h) => {
    const s = h._source
    const title = text(s.resourceTitleObject) ?? s.uuid
    const tags = (s.tag ?? []).map(text).filter(Boolean).slice(0, 12).join(', ')
    const themes = [s.inspireTheme_syn].flat().filter(Boolean).slice(0, 4).join(', ')
    return {
      id: s.uuid,
      src: 'c',
      title,
      text: `${title}. ${clip(text(s.resourceAbstractObject), 500)} ${themes ? `Thèmes : ${themes}.` : ''} ${tags ? `Mots-clés : ${tags}.` : ''}`,
    }
  })
}

/**
 * Couches OUVERTES de l'index de recherche. L'API plafonne chaque requête à 10 000 documents :
 * on partitionne par protocole pour tout couvrir. Les offres à accès restreint ne sont pas
 * vectorisées (elles ne sont de toute façon ni affichables ni utilisables ici) ; la recherche
 * lexicale continue de les signaler.
 */
async function indexItems() {
  const byLayer = new Map()
  for (const type of ['WMTS', 'WMS', 'WFS', 'TMS']) {
    for (let page = 1; page <= 20; page++) {
      const r = await post(`${INDEX}?page=${page}&size=500`, { type, open: true })
      const docs = r.documents ?? []
      for (const d of docs) if (d.layer_name && d.open !== false && !byLayer.has(d.layer_name)) byLayer.set(d.layer_name, d)
      if (docs.length < 500) break
    }
  }
  return [...byLayer.values()].map((d) => ({
    id: d.layer_name,
    src: 'i',
    title: d.title || d.layer_name,
    text: `${d.title || d.layer_name}. ${clip(d.description, 400)} ${d.keywords?.length ? `Mots-clés : ${d.keywords.slice(0, 10).join(', ')}.` : ''}`,
  }))
}

/** Écarte le bruit : titres trop courts (« image »), couches de test ou de démonstration, descriptions vides. */
const useful = (it) => it.title.trim().length >= 5 && it.text.length >= 60 && !/\b(test|demo|démo|essai|tmp)\b|^\[?demo/i.test(it.title)

const all = [...(await catalogueItems()), ...(await indexItems())]
const items = all.filter(useful)
console.log(`${all.length - items.length} éléments écartés (titre court, test, description vide)`)
console.log(`${items.length} éléments à vectoriser`)

const extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' })
const dim = 384
const q = new Int8Array(items.length * dim)
const BATCH = 16
for (let i = 0; i < items.length; i += BATCH) {
  const chunk = items.slice(i, i + BATCH)
  const out = await extractor(chunk.map((it) => `passage: ${it.text}`), { pooling: 'mean', normalize: true })
  const flat = out.data
  // Vecteurs normalisés : composantes dans [-1, 1] → entiers 8 bits (précision ~0,008, sans effet sur le classement).
  for (let k = 0; k < chunk.length * dim; k++) q[i * dim + k] = Math.max(-127, Math.min(127, Math.round(flat[k] * 127)))
  process.stdout.write(`\r${Math.min(i + BATCH, items.length)}/${items.length}`)
}

mkdirSync('public/semantic', { recursive: true })
const index = {
  model: MODEL,
  dtype: 'q8',
  dim,
  scale: 127,
  createdAt: new Date().toISOString(),
  items: items.map(({ id, src, title }) => ({ id, src, title })),
  vectors: Buffer.from(q.buffer).toString('base64'),
}
writeFileSync('public/semantic/index.json', JSON.stringify(index))
console.log(`\npublic/semantic/index.json écrit (${(JSON.stringify(index).length / 1024).toFixed(0)} Ko, ${items.length} éléments)`)
