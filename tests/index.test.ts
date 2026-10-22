import { afterEach, describe, expect, it, vi } from 'vitest'
import { groupDocuments, searchIndex, type IndexDocument } from '../src/api/searchIndex'
import { parseRecord } from '../src/api/catalogue'
import { groupByLayer, restrictedServices } from '../src/gis/capabilities'
import { mergeDatasets, searchAll } from '../src/services/search'
import { accessLevel } from '../src/types'
import { BDTOPO_RECORD } from './fixtures'

/** FIXTURES DE TEST : documents de l'index de recherche (forme observée le 2026-10-21, raccourcie). */
const doc = (over: Partial<IndexDocument>): IndexDocument => ({
  id: 'd1', layer_name: 'patrinat_inpg:inpg', title: 'Patrinat : INPG', description: 'Périmètre des INPG', type: 'WFS',
  url: 'https://data.geopf.fr/wfs?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=patrinat_inpg:inpg', open: true,
  keywords: ['INPG'], extent: { type: 'Polygon', coordinates: [[[55.9, -21.6], [55.9, 51.2], [-61.9, 51.2], [-61.9, -21.6], [55.9, -21.6]]] },
  ...over,
})
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })

afterEach(() => vi.unstubAllGlobals())

describe('index de recherche : regroupement par couche', () => {
  it('regroupe les protocoles d’une même couche en une donnée', () => {
    const d = groupDocuments([
      doc({}),
      doc({ id: 'd2', type: 'WMS', url: 'https://data.geopf.fr/wms-v?service=WMS&version=1.3.0&request=GetMap&layers=patrinat_inpg:inpg' }),
      doc({ id: 'd3', layer_name: 'autre', title: 'Autre', type: 'TMS', url: 'https://data.geopf.fr/tms/1.0.0/autre' }),
    ])
    expect(d).toHaveLength(2)
    expect(d[0].id).toBe('index:patrinat_inpg:inpg')
    expect(d[0].source).toBe('index')
    expect(d[0].services.map((s) => s.kind)).toEqual(['WFS', 'WMS'])
    expect(d[0].services[0].endpoint).toBe('https://data.geopf.fr/wfs')
    expect(d[0].services[0].capabilitiesUrl).toBe('https://data.geopf.fr/wfs?SERVICE=WFS&REQUEST=GetCapabilities')
    expect(d[0].extents[0]).toEqual([-61.9, -21.6, 55.9, 51.2])
    expect(d[0].downloads).toEqual([])
  })

  it('marque les offres non ouvertes comme restreintes et les écarte des usages', () => {
    const [d] = groupDocuments([doc({ open: false, url: 'https://data.geopf.fr/private/wfs/?service=WFS&request=DescribeFeatureType' })])
    expect(d.services[0].restricted).toBe(true)
    expect(accessLevel(d)).toBe('restricted')
    expect(groupByLayer(d.services)).toEqual([])
    expect(restrictedServices(d.services)).toHaveLength(1)
  })

  it('niveau « partiel » quand une couche a des accès ouverts et réservés', () => {
    const [d] = groupDocuments([
      doc({}),
      doc({ id: 'x', type: 'WMS', open: false, url: 'https://data.geopf.fr/private/wms-r/?service=WMS&request=GetMap' }),
    ])
    expect(accessLevel(d)).toBe('partial')
    expect(groupByLayer(d.services)).toHaveLength(1)
  })

  it('ignore les types non exploités (ALTIMETRY, DOWNLOAD) et les documents incomplets', () => {
    expect(groupDocuments([doc({ type: 'ALTIMETRY', url: 'EndpointUrl(type=ALTIMETRY)' }), doc({ layer_name: '' })])).toEqual([])
  })
})

describe('index de recherche : appels', () => {
  it('interroge title, keywords et description pour chaque terme, puis fusionne sans doublon', async () => {
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(String(init.body))
      return json({ documents: [doc({})] })
    }))
    const r = await searchIndex('patrinat')
    const fields = new Set(bodies.map((b) => Object.keys(JSON.parse(b))[0]))
    expect([...fields].sort()).toEqual(['description', 'keywords', 'title'])
    expect(bodies.length % 3).toBe(0)
    expect(r).toHaveLength(1)
  })

  it('texte vide : aucun appel', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await searchIndex('  ')).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })

  it('propage une réponse inattendue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'x' })))
    await expect(searchIndex('x')).rejects.toThrow(/inattendue/)
  })
})

describe('recherche fusionnée catalogue + index', () => {
  const catalogue = parseRecord(BDTOPO_RECORD)

  it('écarte les couches de l’index déjà publiées par une fiche du catalogue', () => {
    const dup = groupDocuments([doc({ layer_name: 'BDTOPO_V3:batiment', title: 'Bâtiment' })])
    const fresh = groupDocuments([doc({})])
    expect(mergeDatasets([catalogue], [...dup, ...fresh]).map((d) => d.id)).toEqual(['IGNF_BD-TOPO', 'index:patrinat_inpg:inpg'])
  })

  function stubBoth(catalogueOk: boolean, indexOk: boolean) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/catalog/')) return catalogueOk ? json({ hits: { total: { value: 1 }, hits: [{ _source: BDTOPO_RECORD }] } }) : json({}, 500)
      return indexOk ? json({ documents: [doc({})] }) : json({}, 503)
    }))
  }

  it('renvoie les deux sources', async () => {
    stubBoth(true, true)
    const r = await searchAll('topo')
    expect(r.datasets.map((d) => d.source)).toEqual(['catalogue', 'index'])
    expect(r.catalogueTotal).toBe(1)
    expect(r.indexCount).toBe(1)
    expect(r.failures).toEqual([])
  })

  it('résultat partiel si une source échoue, avec le motif', async () => {
    stubBoth(true, false)
    const r = await searchAll('topo')
    expect(r.datasets).toHaveLength(1)
    expect(r.failures).toEqual([{ source: 'index', message: expect.stringContaining('503') }])
    stubBoth(false, true)
    const r2 = await searchAll('topo')
    expect(r2.datasets[0].source).toBe('index')
    expect(r2.failures[0].source).toBe('catalogue')
  })

  it('erreur si les deux échouent', async () => {
    stubBoth(false, false)
    await expect(searchAll('topo')).rejects.toThrow()
  })
})
