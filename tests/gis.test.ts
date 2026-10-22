import { describe, expect, it } from 'vitest'
import { defaultLayer, groupByLayer, usableServices, validateServiceUrl } from '../src/gis/capabilities'
import { buildQlr, escapeXml, qgisSource, qlrFileName } from '../src/gis/export/qgis'
import { GISIntegrationService } from '../src/gis/GISIntegrationService'
import { genericAdapter } from '../src/gis/adapters/generic'
import { parseRecord } from '../src/api/catalogue'
import type { Dataset, ServiceAccess } from '../src/types'
import { BDTOPO_RECORD, MINIMAL_RECORD } from './fixtures'

const WMTS: ServiceAccess = { kind: 'WMTS', endpoint: 'https://data.geopf.fr/wmts', capabilitiesUrl: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities', layer: 'ORTHOIMAGERY.ORTHOPHOTOS' }
const WMS: ServiceAccess = { kind: 'WMS', endpoint: 'https://data.geopf.fr/wms-r', layer: 'ORTHOIMAGERY.ORTHOPHOTOS' }
const WFS: ServiceAccess = { kind: 'WFS', endpoint: 'https://data.geopf.fr/wfs/ows', layer: 'BDTOPO_V3:batiment' }
const TMS: ServiceAccess = { kind: 'TMS', endpoint: 'https://data.geopf.fr/tms/1.0.0', layer: 'BDTOPO' }
const wmtsInfo = { layer: WMTS.layer, style: 'normal', format: 'image/jpeg', tileMatrixSet: 'PM' }

const dataset = (services: ServiceAccess[]): Dataset => ({ ...parseRecord(MINIMAL_RECORD), title: 'Ortho', services })

describe('recommandation du mode d’accès', () => {
  it('WMS seul → WMS ; WMS + WMTS → WMTS (critère : tuiles pré-calculées) ; WFS seul → WFS', () => {
    expect(groupByLayer([WMS])[0].recommended.kind).toBe('WMS')
    const both = groupByLayer([WMS, WMTS])
    expect(both).toHaveLength(1)
    expect(both[0].recommended.kind).toBe('WMTS')
    expect(both[0].reason).toMatch(/rapide/)
    expect(groupByLayer([WFS])[0].recommended.kind).toBe('WFS')
  })

  it('le TMS est proposé (URL à copier) mais jamais recommandé avant un service d’image ou WFS', () => {
    expect(usableServices([TMS, WMS])).toEqual([TMS, WMS])
    expect(groupByLayer([TMS])[0].recommended.kind).toBe('TMS')
    expect(groupByLayer([{ ...TMS, layer: 'L' }, { ...WMS, layer: 'L' }])[0].recommended.kind).toBe('WMS')
    expect(usableServices([{ ...WMS, restricted: true }])).toEqual([])
  })

  it('propose d’abord une couche affichable', () => {
    expect(defaultLayer(groupByLayer([WFS, WMS]))?.layer).toBe(WMS.layer)
    expect(defaultLayer([])).toBeUndefined()
  })

  it('sur la fiche réelle BD TOPO : 3 modes regroupés par couche', () => {
    const layers = groupByLayer(parseRecord(BDTOPO_RECORD).services)
    expect(layers.map((l) => l.recommended.kind).sort()).toEqual(['TMS', 'WFS', 'WMS', 'WMTS'])
  })
})

describe('sécurité des URLs', () => {
  it('accepte https, refuse le reste', () => {
    expect(validateServiceUrl('https://data.geopf.fr/wmts').hostname).toBe('data.geopf.fr')
    for (const bad of ['http://x.fr/wms', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://x', 'https://u:p@x.fr', 'https://x.fr/a b', 'https://x.fr/"><script>', 'pas une url']) {
      expect(() => validateServiceUrl(bad), bad).toThrow()
    }
  })
})

describe('génération QGIS', () => {
  it('WMS', () => {
    const s = qgisSource(WMS, 'Ortho')
    expect(s.provider).toBe('wms')
    expect(s.uri).toContain('layers=ORTHOIMAGERY.ORTHOPHOTOS')
    expect(s.uri).toContain('crs=EPSG:3857')
    expect(s.uri).toContain('url=https://data.geopf.fr/wms-r')
  })

  it('WMTS (paramètres issus des capacités du service)', () => {
    const s = qgisSource(WMTS, 'Ortho', wmtsInfo)
    expect(s.uri).toContain('tileMatrixSet=PM')
    expect(s.uri).toContain('format=image/jpeg')
    expect(s.uri).toContain('styles=normal')
    expect(s.uri).toContain('url=https://data.geopf.fr/wmts?SERVICE%3DWMTS%26REQUEST%3DGetCapabilities')
    expect(() => qgisSource(WMTS, 'Ortho')).toThrow(/WMTS/)
  })

  it('WFS', () => {
    const s = qgisSource(WFS, 'Bâti')
    expect(s.provider).toBe('WFS')
    expect(s.layerType).toBe('vector')
    expect(s.uri).toContain(`typename='BDTOPO_V3:batiment'`)
    expect(s.uri).toContain(`url='https://data.geopf.fr/wfs/ows'`)
  })

  it('refuse un protocole non supporté et une URL incorrecte', () => {
    expect(() => qgisSource(TMS, 'x')).toThrow(/non supporté/)
    expect(() => qgisSource({ ...WMS, endpoint: 'http://x.fr/wms' }, 'x')).toThrow(/Protocole/)
    expect(() => qgisSource({ ...WMS, endpoint: 'javascript:alert(1)' }, 'x')).toThrow()
  })

  it('produit un .qlr bien formé, échappé, sans code exécutable', () => {
    const qlr = buildQlr([qgisSource(WMS, 'A & <B> "C"'), qgisSource(WFS, 'Bâti')])
    expect(qlr.startsWith('<!DOCTYPE qgis-layer-definition>')).toBe(true)
    expect(qlr).toContain('A &amp; &lt;B&gt; &quot;C&quot;')
    expect(qlr).not.toContain('<B>')
    expect(qlr.match(/<maplayer /g)).toHaveLength(2)
    expect(qlr).not.toMatch(/python|<script|os\.system/i)
    const doc = new DOMParser().parseFromString(qlr.replace('<!DOCTYPE qgis-layer-definition>', ''), 'application/xml')
    expect(doc.querySelector('parsererror')).toBeNull()
  })

  it('nom de fichier sûr', () => {
    expect(qlrFileName('BD TOPO® — Bâtiments/../x')).toBe('BD_TOPO_Batiments_x.qlr')
    expect(qlrFileName('???')).toBe('donnee.qlr')
    expect(escapeXml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;')
  })
})

describe('GISIntegrationService', () => {
  const service = new GISIntegrationService()

  it('ressource avec plusieurs modes : recommande WMTS et propose QGIS + autre logiciel', () => {
    const o = service.getOptions({ resource: dataset([WMS, WMTS]), availableServices: [WMS, WMTS] })
    expect(o.selectedLayer).toBe(WMTS.layer)
    expect(o.clients.map((c) => c.id)).toEqual(['qgis', 'generic'])
    expect(o.clients[0].actions.map((a) => a.id)).toEqual(['qgis-qlr', 'qgis-uri'])
    expect(o.clients[1].actions.map((a) => a.protocol).sort()).toEqual(['WMS', 'WMTS'])
  })

  it('TMS seul : URL à copier pour un autre logiciel, rien pour QGIS', () => {
    const o = service.getOptions({ resource: dataset([TMS]), availableServices: [TMS] })
    expect(o.clients.map((c) => c.id)).toEqual(['generic'])
    return o.clients[0].actions[0].run().then((out) => expect(out).toEqual({ kind: 'text', text: 'https://data.geopf.fr/tms/1.0.0/BDTOPO/metadata.json' }))
  })

  it('ressource sans mode SIG ouvert : aucune action', () => {
    const restricted = { ...WMS, restricted: true }
    expect(service.getOptions({ resource: dataset([restricted]), availableServices: [restricted] })).toEqual({ layers: [], clients: [] })
    expect(service.getOptions({ resource: dataset([]), availableServices: [] }).clients).toEqual([])
  })

  it('l’action WMS QGIS produit un fichier .qlr', async () => {
    const o = service.getOptions({ resource: dataset([WMS]), availableServices: [WMS] })
    const out = await o.clients[0].actions[0].run()
    expect(out.kind).toBe('file')
    if (out.kind === 'file') {
      expect(out.fileName).toBe('Ortho_ORTHOIMAGERY_ORTHOPHOTOS.qlr')
      expect(out.content).toContain('<qlr>')
    }
  })

  it('l’action « copier la connexion » WFS renvoie la source QGIS', async () => {
    const o = service.getOptions({ resource: dataset([WFS]), availableServices: [WFS] })
    const out = await o.clients[0].actions[1].run()
    expect(out).toMatchObject({ kind: 'text' })
  })

  it('l’adaptateur générique ignore les URLs invalides et un nouvel adaptateur s’ajoute sans toucher au reste', async () => {
    const bad = { ...WMS, endpoint: 'http://insecure.fr/wms', capabilitiesUrl: undefined }
    expect(genericAdapter.actions({ resource: dataset([bad]), availableServices: [bad], selectedLayer: bad.layer })).toEqual([])
    const custom = new GISIntegrationService([{ id: 'x', label: 'Autre SIG', instructions: [], actions: () => [{ id: 'a', label: 'A', description: '', protocol: 'WMS', run: async () => ({ kind: 'text', text: 't' }) }] }])
    expect(custom.getOptions({ resource: dataset([WMS]), availableServices: [WMS] }).clients[0].id).toBe('x')
  })
})
