import { describe, expect, it, vi } from 'vitest'
import { AuthState, base64url, challengeS256, decodeJwt, generateVerifier } from '../src/auth/auth'
import { ExtractionApi, ExtractionError, describeExtractionError } from '../src/extraction/api'
import { buildExtractionPlan, editableFields, matchProcesses, nativeSrid } from '../src/extraction/builder'
import { ExtractionController } from '../src/extraction/controller'
import { bboxExpression, fitExtent } from '../src/extraction/fit'
import { parseAtomEntries, parseProcessDetails, parseStoredData, isRunning, isSuccessful } from '../src/extraction/models'
import { isSupportedSrid, parseSrid, projectGeometry } from '../src/extraction/srs'
import { decodeTwkb, encodeTwkb, twkbHex } from '../src/extraction/twkb'
import { initialExtraction, Store } from '../src/state/store'
import { bboxToPolygon, type Geometry } from '../src/utils/geo'

/** FIXTURES DE TEST : forme des réponses de l'API d'extraction telle que documentée par son OpenAPI. */
const PROCESS_BDTOPO = {
  id: 'bdtopo-extraction',
  title: 'BD TOPO® - Extraction',
  description: 'Extraction de la BD TOPO',
  inputs: {
    relations: { title: 'Tables', schema: { type: 'object' } },
    format: { title: 'Format', schema: { type: 'string', enum: ['SHP', 'GPKG'] } },
    srs: { title: 'Projection', schema: { type: 'string', enum: ['EPSG:2154', 'EPSG:4326'], default: 'EPSG:2154' } },
    append: { title: 'Fusionner', schema: { type: 'boolean' } },
  },
  outputs: { logs: {}, summary: {}, extractedData: {}, jobName: {} },
  links: [{ rel: 'describedby', href: 'https://data.geopf.fr/extraction/stored/bdtopo' }],
}
const STORED = {
  _id: 'abc',
  name: 'BDTOPO',
  srs: 'EPSG:2154',
  type_infos: {
    relations: [
      { name: 'batiment', attributes: { id: 'string', geom: 'geometry(MultiPolygon,2154)' } },
      { name: 'route', attributes: { id: 'string', geom: 'geometry(LineString,2154)' } },
    ],
  },
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

describe('TWKB', () => {
  const poly = [[[[2.35, 48.85], [2.36, 48.85], [2.36, 48.86], [2.35, 48.86], [2.35, 48.85]]]]

  it('aller-retour sans perte à la précision demandée', () => {
    const back = decodeTwkb(encodeTwkb(poly, 6))
    expect(back[0][0]).toHaveLength(5)
    back[0][0].forEach((p, i) => {
      expect(p[0]).toBeCloseTo(poly[0][0][i][0], 6)
      expect(p[1]).toBeCloseTo(poly[0][0][i][1], 6)
    })
  })

  it('encode des coordonnées projetées (> 2^31 en centimètres)', () => {
    const lambert = [[[[652000.12, 6862000.34], [652100, 6862000], [652100, 6862100], [652000.12, 6862000.34]]]]
    const back = decodeTwkb(encodeTwkb(lambert, 2))
    expect(back[0][0][0][0]).toBeCloseTo(652000.12, 2)
    expect(back[0][0][0][1]).toBeCloseTo(6862000.34, 2)
  })

  it('est nettement plus compact que le WKT', () => {
    const ring = Array.from({ length: 500 }, (_, i) => [2 + Math.cos(i / 80) * 0.01, 48 + Math.sin(i / 80) * 0.01])
    ring.push(ring[0])
    expect(twkbHex([[ring]], 6).length / 2).toBeLessThan(ring.length * 8)
    expect(() => encodeTwkb(poly, 9)).toThrow(RangeError)
  })
})

describe('projections natives', () => {
  it('reconnaît les SRID gérés et refuse les autres', () => {
    expect(parseSrid('EPSG:2154')).toBe(2154)
    expect(isSupportedSrid(2154)).toBe(true)
    expect(isSupportedSrid(2972)).toBe(true)
    expect(isSupportedSrid(27572)).toBe(false)
    expect(nativeSrid({ id: '', name: '', srs: 'EPSG:27572', tables: [] })).toBeUndefined()
  })

  it('reprojette en gardant l’ordre x=est, y=nord (Paris → Lambert-93)', () => {
    const g = projectGeometry(bboxToPolygon([2.35, 48.85, 2.36, 48.86]), 2154) as { coordinates: number[][][] }
    const [x, y] = g.coordinates[0][0]
    expect(x).toBeGreaterThan(651000)
    expect(x).toBeLessThan(653000)
    expect(y).toBeGreaterThan(6860000)
    expect(y).toBeLessThan(6864000)
    expect(() => projectGeometry(bboxToPolygon([0, 0, 1, 1]), 12345)).toThrow(/non gérée/)
  })
})

describe('adaptation du contour au budget de taille', () => {
  const circle = (n: number): Geometry => ({
    type: 'Polygon',
    coordinates: [Array.from({ length: n + 1 }, (_, i) => [2.4 + 0.05 * Math.cos((2 * Math.PI * (i % n)) / n), 48.85 + 0.05 * Math.sin((2 * Math.PI * (i % n)) / n)])],
  })

  it('garde le contour précis quand il tient', () => {
    const f = fitExtent(bboxToPolygon([2.35, 48.85, 2.36, 48.86]), 2154, 5000)
    expect(f.mode).toBe('precise')
    expect(f.expression).toMatch(/^ST_SetSRID\(ST_GeomFromTWKB\(decode\('[0-9a-f]+','hex'\)\), 2154\)$/)
  })

  it('simplifie (puis élargit) un contour trop lourd', () => {
    const f = fitExtent(circle(6000), 2154, 6000)
    expect(f.mode).toBe('simplified')
    expect(f.toleranceM).toBeGreaterThan(0)
    expect(f.bytes).toBeLessThanOrEqual(6000)
  })

  it('retombe sur le rectangle englobant si rien ne tient', () => {
    const f = fitExtent(circle(6000), 2154, 200)
    expect(f.mode).toBe('bbox')
    expect(f.expression).toMatch(/^ST_MakeEnvelope\(\d+(\.\d+)?, \d+(\.\d+)?, \d+(\.\d+)?, \d+(\.\d+)?, 2154\)$/)
  })

  it('l’enveloppe est en x=est (≈ 650 000) puis y=nord (≈ 6 860 000)', () => {
    const m = /ST_MakeEnvelope\(([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)/.exec(bboxExpression(bboxToPolygon([2.35, 48.85, 2.36, 48.86]), 2154))!
    expect(Number(m[1])).toBeLessThan(Number(m[3]))
    expect(Number(m[1])).toBeGreaterThan(600000)
    expect(Number(m[2])).toBeGreaterThan(6000000)
  })
})

describe('modèles', () => {
  it('lit un produit : champs, sorties et lien describedby (sans jobName)', () => {
    const p = parseProcessDetails(PROCESS_BDTOPO)
    expect(p.inputs.map((f) => f.id)).toEqual(['relations', 'format', 'srs', 'append'])
    expect(p.describedByUrl).toBe('https://data.geopf.fr/extraction/stored/bdtopo')
    expect(editableFields(p).map((f) => f.id)).toEqual(['format', 'srs', 'append'])
  })

  it('lit la donnée stockée : tables et attribut géométrique', () => {
    const s = parseStoredData(STORED)
    expect(s.tables.map((t) => t.name)).toEqual(['batiment', 'route'])
    expect(s.tables[0].geometryAttribute).toBe('geom')
    expect(s.srs).toBe('EPSG:2154')
  })

  it('supporte la forme « liste » des entrées', () => {
    const p = parseProcessDetails({ id: 'x', inputs: [{ id: 'relations' }, { title: 'Durée de rétention', schema: { type: 'integer' } }], outputs: [{ id: 'logs' }] })
    expect(p.inputs.map((f) => f.id)).toEqual(['relations', 'lifetime'])
    expect(p.outputIds).toEqual(['logs'])
  })

  it('lit le flux Atom des fichiers de résultat', () => {
    const xml = `<feed><entry><link href="https://data.geopf.fr/x/res.gpkg.7z?a=1&amp;b=2" type="application/x-7z-compressed"/></entry>
      <entry><link href="https://data.geopf.fr/x/extraction.json"/><mime_type>application/json</mime_type></entry></feed>`
    const files = parseAtomEntries(xml)
    expect(files).toHaveLength(2)
    expect(files[0].href).toBe('https://data.geopf.fr/x/res.gpkg.7z?a=1&b=2')
    expect(files[0].filename).toBe('res.gpkg.7z')
    expect(files[1].isMetadata).toBe(true)
  })

  it('statuts de job', () => {
    expect(isRunning('RUNNING')).toBe(true)
    expect(isSuccessful('SUCCESSFUL')).toBe(true)
    expect(isRunning('SUCCESSFUL')).toBe(false)
  })
})

describe('rapprochement donnée ↔ produit (heuristique)', () => {
  const processes = [
    { id: 'orthophotos', title: 'Orthophotographies', description: '' },
    { id: 'bdtopo-extraction', title: 'BD TOPO® - Extraction', description: '' },
    { id: 'adresse', title: 'Adresse Premium', description: '' },
  ]
  it('classe d’abord le produit qui partage les mots du titre', () => {
    const m = matchProcesses({ title: 'BD TOPO®', downloads: [{ id: 'BDTOPO', title: '', url: '' }] }, processes)
    expect(m[0].process.id).toBe('bdtopo-extraction')
    expect(m[0].score).toBe(1)
    expect(m[2].score).toBe(0)
  })
  it('score nul sans mot commun', () => {
    expect(matchProcesses({ title: 'Cadastre', downloads: [] }, processes).every((x) => x.score === 0)).toBe(true)
  })
})

describe('construction de la requête', () => {
  const process = parseProcessDetails(PROCESS_BDTOPO)
  const stored = parseStoredData(STORED)
  const area = bboxToPolygon([2.35, 48.85, 2.36, 48.86])

  it('filtre chaque table par ST_Intersects sur son attribut géométrique, sans jobName', () => {
    const plan = buildExtractionPlan(process, stored, stored.tables, area, { format: 'GPKG', srs: 'EPSG:2154', append: false })
    const rel = (plan.body.inputs.relations as Record<string, { attributes: string[]; filters: string }>)
    expect(Object.keys(rel)).toEqual(['batiment', 'route'])
    expect(rel.batiment.filters).toMatch(/^ST_Intersects\(geom, ST_SetSRID\(ST_GeomFromTWKB/)
    expect(rel.batiment.attributes).toEqual(['id', 'geom'])
    expect(plan.body.inputs.format).toBe('GPKG')
    expect(Object.keys(plan.body.outputs)).toEqual(['logs', 'summary', 'extractedData'])
    expect(plan.bodyBytes).toBeGreaterThan(100)
  })

  it('respecte le budget en répartissant la taille entre les tables', () => {
    const big: Geometry = {
      type: 'Polygon',
      coordinates: [Array.from({ length: 4001 }, (_, i) => [2.4 + 0.05 * Math.cos((2 * Math.PI * (i % 4000)) / 4000), 48.85 + 0.05 * Math.sin((2 * Math.PI * (i % 4000)) / 4000)])],
    }
    const plan = buildExtractionPlan(process, stored, stored.tables, big, {}, 20_000)
    expect(plan.bodyBytes).toBeLessThan(20_000)
    expect(plan.extent?.mode).not.toBe('precise')
  })

  it('refuse sans table et pour une projection native non gérée', () => {
    expect(() => buildExtractionPlan(process, stored, [], area, {})).toThrow(/table/)
    expect(() => buildExtractionPlan(process, { ...stored, srs: 'EPSG:27572' }, stored.tables, area, {})).toThrow(/non gérée/)
  })
})

describe('client d’extraction', () => {
  it('envoie le jeton Bearer et lit les produits', async () => {
    const fetchImpl = vi.fn(async () => json({ processes: [{ id: 'a', title: 'A' }] })) as unknown as typeof fetch
    const api = new ExtractionApi({ getToken: () => 'TOK', fetchImpl })
    expect(await api.listProcesses()).toEqual([{ id: 'a', title: 'A', description: '' }])
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOK')
  })

  it('n’envoie pas le jeton pour le flux de téléchargement public', async () => {
    const fetchImpl = vi.fn(async () => new Response('<feed></feed>')) as unknown as typeof fetch
    await new ExtractionApi({ getToken: () => 'TOK', fetchImpl }).resolveDownloadFiles('https://data.geopf.fr/x')
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('traduit les erreurs du service (401, 429, 500, réseau)', async () => {
    const api = (status: number) => new ExtractionApi({ fetchImpl: (async () => new Response('{"detail":"x"}', { status })) as unknown as typeof fetch })
    for (const [status, text] of [[401, /expiré/], [429, /Un seul job/], [500, /refusé/], [403, /droits/]] as const) {
      const err = await api(status).listProcesses().catch((e) => e)
      expect(err).toBeInstanceOf(ExtractionError)
      expect(describeExtractionError(err)).toMatch(text)
    }
    const net = await new ExtractionApi({ fetchImpl: (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch }).getJob('1').catch((e) => e)
    expect(net.status).toBe(0)
    expect(describeExtractionError(net)).toMatch(/Requête impossible/)
  })

  it('le rapport d’erreur contient la requête et la réponse mais jamais le jeton', async () => {
    const api = new ExtractionApi({ getToken: () => 'SECRET', fetchImpl: (async () => new Response('{"detail":"trop gros"}', { status: 500 })) as unknown as typeof fetch })
    const err = (await api.execute('p', { inputs: { a: 1 } }).catch((e) => e)) as ExtractionError
    expect(err.report()).toContain('"a": 1')
    expect(err.report()).toContain('trop gros')
    expect(err.report()).not.toContain('SECRET')
  })
})

describe('contrôleur d’extraction (service simulé)', () => {
  function setup() {
    const store = new Store()
    const auth = new AuthState(undefined)
    const jobs: string[] = ['RUNNING', 'SUCCESSFUL']
    const calls: string[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url.replace('https://data.geopf.fr/extraction', '')}`)
      if (url.endsWith('/processes?page=1&limit=200')) return json({ processes: [{ id: 'orthophotos', title: 'Orthophotographies' }, { id: 'bdtopo-extraction', title: 'BD TOPO® - Extraction' }] })
      if (url.endsWith('/processes/bdtopo-extraction')) return json(PROCESS_BDTOPO)
      if (url.includes('/stored/')) return json(STORED)
      if (url.endsWith('/execution')) return json({ jobID: 'j1', status: 'ACCEPTED' })
      if (url.endsWith('/jobs/j1')) return json({ jobID: 'j1', status: jobs.shift() ?? 'SUCCESSFUL' })
      if (url.endsWith('/jobs/j1/results')) return json({ logs: 'ok', extractData: { href: 'https://data.geopf.fr/dl/atom' } })
      if (url.endsWith('/dl/atom')) return new Response('<feed><entry><link href="https://data.geopf.fr/dl/BDTOPO.gpkg.7z"/></entry></feed>')
      return new Response('?', { status: 404 })
    }) as unknown as typeof fetch
    const ctl = new ExtractionController(store, auth, new ExtractionApi({ getToken: () => auth.token, fetchImpl }), 5)
    return { store, auth, ctl, calls }
  }
  const dataset = { title: 'BD TOPO®', downloads: [{ id: 'BDTOPO', title: '', url: '' }] } as never

  it('sans jeton : rien n’est appelé', async () => {
    const { ctl, calls, store } = setup()
    await ctl.loadProcesses(dataset)
    expect(calls).toEqual([])
    expect(store.get().extraction.processes.status).toBe('idle')
  })

  it('parcours complet : produits → produit proposé → tables → lancement → job → fichiers', async () => {
    const { ctl, store, auth } = setup()
    auth.setToken('tok')
    await ctl.loadProcesses(dataset)
    let x = store.get().extraction
    expect(x.processes.status).toBe('ready')
    expect(x.processId).toBe('bdtopo-extraction')
    expect(x.details.status).toBe('ready')
    expect(x.selectedTables).toEqual(['batiment', 'route'])
    expect(x.values.format).toBe('GPKG')

    ctl.toggleTable('route')
    expect(store.get().extraction.selectedTables).toEqual(['batiment'])

    store.set({ area: { geometry: bboxToPolygon([2.35, 48.85, 2.36, 48.86]), bbox: [2.35, 48.85, 2.36, 48.86], areaSqm: 1, source: 'rectangle', label: 'x' } })
    await ctl.launch()
    expect(store.get().extraction.job?.jobId).toBe('j1')
    expect(store.get().extraction.plan?.tables).toBe(1)

    await vi.waitFor(() => expect(store.get().extraction.files).toBeDefined(), { timeout: 3000 })
    x = store.get().extraction
    expect(x.job?.status).toBe('SUCCESSFUL')
    expect(x.files?.[0].filename).toBe('BDTOPO.gpkg.7z')
    ctl.reset()
  })

  it('un 429 au lancement est expliqué', async () => {
    const store = new Store()
    const auth = new AuthState(undefined)
    auth.setToken('tok')
    const api = new ExtractionApi({ getToken: () => 'tok', fetchImpl: (async (url: string) => {
      if (url.includes('/processes?')) return json({ processes: [{ id: 'bdtopo-extraction', title: 'BD TOPO' }] })
      if (url.endsWith('/processes/bdtopo-extraction')) return json(PROCESS_BDTOPO)
      if (url.includes('/stored/')) return json(STORED)
      return new Response('busy', { status: 429 })
    }) as unknown as typeof fetch })
    const ctl = new ExtractionController(store, auth, api, 5)
    await ctl.loadProcesses(dataset)
    store.set({ area: { geometry: bboxToPolygon([2.35, 48.85, 2.36, 48.86]), bbox: [2.35, 48.85, 2.36, 48.86], areaSqm: 1, source: 'rectangle', label: 'x' } })
    await ctl.launch()
    expect(store.get().extraction.error?.message).toMatch(/Un seul job/)
    expect(store.get().extraction.error?.report).toContain('HTTP 429')
    expect(store.get().extraction.launching).toBe(false)
    expect(initialExtraction.launching).toBe(false)
  })
})

describe('authentification', () => {
  const jwt = (claims: object) => `h.${base64url(new TextEncoder().encode(JSON.stringify(claims)))}.s`

  it('lit les revendications d’un JWT sans le vérifier', () => {
    expect(decodeJwt(jwt({ name: 'Ada', exp: 123 }))).toMatchObject({ name: 'Ada', exp: 123 })
    expect(decodeJwt('pas-un-jwt')).toBeNull()
  })

  it('jeton valide, expiré, ou sans expiration', () => {
    const a = new AuthState(undefined)
    a.setToken(`Bearer ${jwt({ exp: Math.floor(Date.now() / 1000) + 600, name: 'Ada' })}`)
    expect(a.authenticated).toBe(true)
    expect(a.userLabel).toBe('Ada')
    expect(a.secondsLeft).toBeGreaterThan(500)
    a.setToken(jwt({ exp: Math.floor(Date.now() / 1000) - 5 }))
    expect(a.authenticated).toBe(false)
    a.setToken('opaque-token')
    expect(a.authenticated).toBe(true)
    expect(a.secondsLeft).toBeNull()
    a.clear()
    expect(a.authenticated).toBe(false)
  })

  it('ne conserve en sessionStorage que sur demande', () => {
    const store: Record<string, string> = {}
    const storage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v), removeItem: (k: string) => delete store[k] } as unknown as Storage
    const a = new AuthState(storage)
    a.setToken('abc')
    expect(Object.keys(store)).toHaveLength(0)
    a.setToken('abc', true)
    expect(Object.values(store)).toEqual(['abc'])
    expect(new AuthState(storage).token).toBe('abc')
    a.clear()
    expect(Object.keys(store)).toHaveLength(0)
  })

  it('PKCE : vecteur de test de la RFC 7636', async () => {
    expect(await challengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
    expect(generateVerifier().length).toBeGreaterThanOrEqual(43)
  })
})
