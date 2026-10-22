import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSearchBody, parseCatalogueResponse, parseRecord, searchDatasets } from '../src/api/catalogue'
import { getAdminZonesIntersecting, parseDepartements, parsePlaces, departementZoneCode, regionZoneCode } from '../src/api/places'
import { listEditions, parseEditionFiles, parseEditions, parseResourceInfo } from '../src/api/download'
import { ApiError, fetchJson } from '../src/api/http'
import { parseWmtsLayer, wmtsTileUrlTemplate } from '../src/api/wmts'
import { bboxToPolygon } from '../src/utils/geo'
import { BDTOPO_RECORD, EDITIONS_FEED, FILES_FEED, MINIMAL_RECORD, WMTS_CAPABILITIES_SNIPPET, feed } from './fixtures'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('catalogue : parsing des métadonnées', () => {
  const d = parseRecord(BDTOPO_RECORD)

  it('extrait les informations réellement présentes', () => {
    expect(d.id).toBe('IGNF_BD-TOPO')
    expect(d.title).toBe('BD TOPO®')
    expect(d.producer).toBe('IGN')
    expect(d.type).toBe('Collection de données')
    expect(d.edition).toBe('3.5')
    expect(d.resolutions).toHaveLength(2)
    expect(d.temporalExtent).toEqual({ start: '2008-03-18', end: '2026-09-15' })
    expect(d.extents[0]).toEqual([-5.15, 41.32, 9.57, 51.1])
  })

  it('classe les accès, dédoublonne et marque les offres privées et écarte les URLs dangereuses', () => {
    expect(d.downloads.map((x) => x.id)).toEqual(['BDTOPO', 'BDTOPO_EXPRESS'])
    expect(d.services.filter((s) => s.kind === 'WMTS')).toHaveLength(1)
    expect(d.services.find((s) => s.layer === 'prive')?.restricted).toBe(true) // offre /private/ : conservée mais marquée réservée
    expect(d.services.find((s) => s.layer === 'BUILDINGS.BUILDINGS')?.restricted).toBeUndefined()
    expect(d.services.some((s) => s.layer === 'x')).toBe(false)
    expect(d.services.find((s) => s.kind === 'WMS')?.endpoint).toBe('https://data.geopf.fr/wms-r')
    expect(d.services.find((s) => s.kind === 'WFS')?.layer).toBe('BDTOPO_V3:batiment')
    expect(d.documentation).toHaveLength(1)
  })

  it('supporte une métadonnée très partielle', () => {
    const m = parseRecord(MINIMAL_RECORD)
    expect(m.title).toBe('minimal-record')
    expect(m.services).toEqual([])
    expect(m.downloads).toEqual([])
    expect(m.abstract).toBeUndefined()
  })

  it('rejette une réponse inattendue', () => {
    expect(() => parseCatalogueResponse({} as never)).toThrow()
  })

  it('construit une requête de recherche (et match_all si vide)', () => {
    expect(JSON.stringify(buildSearchBody('lidar hd', 5))).toContain('lidar hd')
    expect(buildSearchBody('  ', 5).query).toEqual({ match_all: {} })
  })
})

describe('catalogue : appels réseau', () => {
  it('renvoie les jeux de données', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ hits: { total: { value: 1 }, hits: [{ _source: BDTOPO_RECORD }] } })))
    const r = await searchDatasets('bd topo')
    expect(r.total).toBe(1)
    expect(r.datasets[0].title).toBe('BD TOPO®')
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[1].headers.Accept).toBe('application/json')
  })

  it('gère une réponse vide', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ hits: { total: { value: 0 }, hits: [] } })))
    expect((await searchDatasets('zzz')).datasets).toEqual([])
  })

  it('signale une erreur API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 500)))
    await expect(searchDatasets('x')).rejects.toMatchObject({ kind: 'http', status: 500 })
  })

  it('signale un réseau indisponible', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(searchDatasets('x')).rejects.toMatchObject({ kind: 'network' })
  })

  it('signale un timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('a', 'AbortError'))))))
    const p = fetchJson('https://x.test', { timeoutMs: 50 })
    const assertion = expect(p).rejects.toMatchObject({ kind: 'timeout' })
    await vi.advanceTimersByTimeAsync(60)
    await assertion
  })

  it('distingue une annulation volontaire', async () => {
    const c = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('a', 'AbortError'))))))
    const p = fetchJson('https://x.test', { signal: c.signal })
    c.abort()
    await expect(p).rejects.toBeInstanceOf(ApiError)
    await expect(p).rejects.toMatchObject({ kind: 'aborted' })
  })

  it('signale une réponse illisible', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })))
    await expect(fetchJson('https://x.test')).rejects.toMatchObject({ kind: 'parse' })
  })
})

describe('API de téléchargement : parsing', () => {
  it('lit les éditions et ignore les entrées incomplètes', () => {
    const e = parseEditions(EDITIONS_FEED)
    expect(e).toHaveLength(2)
    expect(e[1]).toMatchObject({ zone: 'D094', format: 'GPKG', date: '2026-09-15', entryId: 'BDTOPO_3-5_TOUSTHEMES_GPKG_LAMB93_D094_2026-09-15' })
  })

  it('lit les fichiers et leur taille réelle', () => {
    const f = parseEditionFiles(FILES_FEED)
    expect(f[0]).toMatchObject({ fileName: 'X.7z', sizeBytes: 260647898 })
    expect(parseEditionFiles(feed({ entry: [{ id: 'a', link: [{ href: 'https://x/y.zip' }] }] }))[0].sizeBytes).toBeUndefined()
  })

  it('lit zones, formats et projections d’une ressource', () => {
    const info = parseResourceInfo(feed({ zone: [{ term: 'D094' }, { term: 'FXX' }], format: [{ term: 'GPKG', label: 'GPKG (GeoPackage)' }], categories: [{ term: 'u', label: 'EPSG:2154' }] }))
    expect(info.zones).toEqual(['D094', 'FXX'])
    expect(info.formats[0]).toEqual({ code: 'GPKG', label: 'GPKG (GeoPackage)' })
    expect(info.crs).toEqual(['EPSG:2154'])
  })

  it('parcourt toutes les pages', async () => {
    const pages = [feed({ page: 1, pagecount: 2, entry: EDITIONS_FEED.entry!.slice(0, 1) }), feed({ page: 2, pagecount: 2, entry: EDITIONS_FEED.entry!.slice(1, 2) })]
    const mock = vi.fn(async (_url: string) => json(pages.shift()))
    vi.stubGlobal('fetch', mock)
    const editions = await listEditions('BDTOPO', { zone: 'D094', format: 'GPKG' })
    expect(editions).toHaveLength(2)
    expect(mock.mock.calls[0][0]).toContain('zone=D094')
    expect(mock.mock.calls[1][0]).toContain('page=2')
  })
})

describe('lieux et limites administratives', () => {
  it('parse le géocodage et ne garde que les communes avec un code INSEE', () => {
    const places = parsePlaces({
      features: [
        { geometry: { coordinates: [2.437785, 48.847279] }, properties: { label: 'Vincennes', type: 'municipality', citycode: '94080', context: '94, Val-de-Marne' } },
        { geometry: { coordinates: [0.64, 43.91] }, properties: { label: 'Vincennes 32700', type: 'locality', citycode: '32208' } },
        { geometry: { coordinates: [Number.NaN, 1] }, properties: { label: 'cassé' } },
      ],
    })
    expect(places).toHaveLength(2)
    expect(places[0]).toMatchObject({ citycode: '94080', lon: 2.437785, lat: 48.847279 })
    expect(places[1].citycode).toBeUndefined()
  })

  it('convertit les codes INSEE en codes de zone', () => {
    expect(departementZoneCode('94')).toBe('D094')
    expect(departementZoneCode('2A')).toBe('D02A')
    expect(departementZoneCode('971')).toBe('D971')
    expect(regionZoneCode('11')).toBe('R11')
  })

  it('lit les départements et leur région', () => {
    const r = parseDepartements({ features: [{ geometry: null, properties: { code_insee: '94', nom_officiel: 'Val-de-Marne', code_insee_de_la_region: '11' } }] })
    expect(r.zones[0]).toEqual({ code: 'D094', name: 'Val-de-Marne', level: 'departement', parentRegion: 'R11' })
    expect(r.regionCodes).toEqual(['11'])
  })

  it('interroge le WFS en lon/lat et renvoie départements + régions', async () => {
    const mock = vi.fn(async (url: string) =>
      url.includes('departement')
        ? json({ features: [{ geometry: null, properties: { code_insee: '94', nom_officiel: 'Val-de-Marne', code_insee_de_la_region: '11' } }] })
        : json({ features: [{ geometry: null, properties: { code_insee: '11', nom_officiel: 'Île-de-France' } }] }),
    )
    vi.stubGlobal('fetch', mock)
    const zones = await getAdminZonesIntersecting(bboxToPolygon([2.41, 48.83, 2.46, 48.86]))
    expect(zones.map((z) => z.code)).toEqual(['D094', 'R11'])
    const url = decodeURIComponent(mock.mock.calls[0][0] as string).replace(/\+/g, ' ')
    expect(url).toContain('INTERSECTS(geometrie,SRID=4326;POLYGON((')
    // x = longitude (≈ 2,4) avant y = latitude (≈ 48,8) : pas d'inversion d'axes
    expect(url).toMatch(/POLYGON\(\(2\.4\d* 48\.8\d*/)
  })
})

describe('WMTS', () => {
  it('lit style par défaut, format, jeu de tuiles et niveaux de zoom', () => {
    expect(parseWmtsLayer(WMTS_CAPABILITIES_SNIPPET, 'BUILDINGS.BUILDINGS')).toEqual({
      layer: 'BUILDINGS.BUILDINGS', style: 'normal', format: 'image/png', tileMatrixSet: 'PM_6_18', minZoom: 6, maxZoom: 18,
    })
    expect(parseWmtsLayer(WMTS_CAPABILITIES_SNIPPET, 'INCONNUE')).toBeUndefined()
  })

  it('construit un gabarit de tuiles KVP', () => {
    const t = wmtsTileUrlTemplate('https://data.geopf.fr/wmts', { layer: 'L', style: 'normal', format: 'image/png', tileMatrixSet: 'PM' })
    expect(t).toContain('LAYER=L')
    expect(t).toContain('TILEMATRIX={z}&TILEROW={y}&TILECOL={x}')
  })
})
