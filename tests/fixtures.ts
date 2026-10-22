/**
 * FIXTURES DE TEST — extraits (raccourcis) de réponses réelles observées le
 * 2026-10-21 sur data.geopf.fr. Ne servent QU'aux tests ; l'application n'utilise
 * jamais ces données.
 */
import type { CatalogueSource } from '../src/api/catalogue'
import type { AtomFeed } from '../src/api/download'
import type { AdminZone } from '../src/types'

export const BDTOPO_RECORD: CatalogueSource = {
  uuid: 'IGNF_BD-TOPO',
  resourceTitleObject: { default: 'BD TOPO®' },
  resourceAbstractObject: { default: 'La BD TOPO® contient une description vectorielle 3D.' },
  OrgForResourceObject: { default: 'IGN' },
  resourceType: ['series'],
  changeDate: '2026-10-07T14:22:57.051179Z',
  resourceEdition: '3.5',
  resolutionScaleDenominator: ['5000', '25000'],
  licenseObject: [{ default: 'Pas de restriction d’accès public selon INSPIRE' }],
  resourceTemporalExtentDetails: [{ start: { date: '2008-03-18' }, end: { date: '2026-09-15' } }],
  geom: [{ type: 'Polygon', coordinates: [[[-5.15, 41.32], [9.57, 41.32], [9.57, 51.1], [-5.15, 51.1], [-5.15, 41.32]]] }],
  link: [
    { protocol: 'WWW:DOWNLOAD-1.0-http--download', urlObject: { default: 'https://data.geopf.fr/telechargement/resource/BDTOPO' }, nameObject: { default: 'BD TOPO® V3' } },
    { protocol: 'WWW:DOWNLOAD-1.0-http--download', urlObject: { default: 'https://data.geopf.fr/telechargement/resource/BDTOPO_EXPRESS' }, nameObject: { default: 'BD TOPO® EXPRESS' } },
    { protocol: 'TMS', urlObject: { default: 'https://data.geopf.fr/tms/1.0.0' }, nameObject: { default: 'BDTOPO' } },
    { protocol: 'OGC:WMTS', urlObject: { default: 'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetCapabilities' }, nameObject: { default: 'BUILDINGS.BUILDINGS' } },
    { protocol: 'OGC:WMTS', urlObject: { default: 'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetCapabilities' }, nameObject: { default: 'BUILDINGS.BUILDINGS' } },
    { protocol: 'OGC:WMS', urlObject: { default: 'https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities' }, nameObject: { default: 'IGNF_TRANSPORTNETWORKS.ROADS' } },
    { protocol: 'OGC:WMS', urlObject: { default: 'https://data.geopf.fr/private/wms-v/' }, nameObject: { default: 'prive' } },
    { protocol: 'OGC:WFS', urlObject: { default: 'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities' }, nameObject: { default: 'BDTOPO_V3:batiment' } },
    { urlObject: { default: 'https://data.geopf.fr/annexes/ressources/documentation/RCQ_BDTOPO.zip' }, nameObject: { default: 'Rapport qualité' } },
    { protocol: 'OGC:WFS', urlObject: { default: 'javascript:alert(1)' }, nameObject: { default: 'x' } },
  ],
}

export const MINIMAL_RECORD: CatalogueSource = { uuid: 'minimal-record' }

export function feed(overrides: Partial<AtomFeed> = {}): AtomFeed {
  return { page: 1, pagecount: 1, ...overrides }
}

export const EDITIONS_FEED: AtomFeed = feed({
  entry: [
    { id: 'https://data.geopf.fr/telechargement/resource/BDTOPO/BDTOPO_3-5_TOUSTHEMES_GPKG_LAMB93_D094_2026-06-15', title: 'BDTOPO_3-5_TOUSTHEMES_GPKG_LAMB93_D094_2026-06-15', editionDate: '2026-06-15', zone: { term: 'D094' }, format: { term: 'GPKG' }, link: [{ rel: 'alternate', href: 'https://data.geopf.fr/telechargement/resource/BDTOPO/BDTOPO_3-5_TOUSTHEMES_GPKG_LAMB93_D094_2026-06-15' }] },
    { id: 'https://data.geopf.fr/telechargement/resource/BDTOPO/BDTOPO_3-5_TOUSTHEMES_GPKG_LAMB93_D094_2026-09-15', title: 'BDTOPO_3-5_TOUSTHEMES_GPKG_LAMB93_D094_2026-09-15', editionDate: '2026-09-15', zone: { term: 'D094' }, format: { term: 'GPKG' }, link: [{ rel: 'alternate', href: 'https://data.geopf.fr/telechargement/resource/BDTOPO/BDTOPO_3-5_TOUSTHEMES_GPKG_LAMB93_D094_2026-09-15' }] },
    { id: 'incomplete', title: 'sans zone ni format' },
  ],
})

export const FILES_FEED: AtomFeed = feed({
  entry: [
    {
      id: 'https://data.geopf.fr/telechargement/download/BDTOPO/X/X.7z',
      link: [{ href: 'https://data.geopf.fr/telechargement/download/BDTOPO/X/X.7z', rel: 'alternate', type: 'application/x-7z-compressed', length: 260647898 }],
    },
  ],
})

export const DEP_94: AdminZone = { code: 'D094', name: 'Val-de-Marne', level: 'departement', parentRegion: 'R11' }
export const DEP_75: AdminZone = { code: 'D075', name: 'Paris', level: 'departement', parentRegion: 'R11' }
export const DEP_93: AdminZone = { code: 'D093', name: 'Seine-Saint-Denis', level: 'departement', parentRegion: 'R11' }
export const REG_11: AdminZone = { code: 'R11', name: 'Île-de-France', level: 'region' }

export const WMTS_CAPABILITIES_SNIPPET = `<Contents><Layer><ows:Title>Bâtiments</ows:Title><ows:Identifier>BUILDINGS.BUILDINGS</ows:Identifier>
<Style isDefault="true"><ows:Title>Légende générique</ows:Title><ows:Identifier>normal</ows:Identifier></Style>
<Style isDefault="false"><ows:Identifier>BUILDINGS.BUILDINGS</ows:Identifier></Style>
<Format>image/png</Format><TileMatrixSetLink><TileMatrixSet>PM_6_18</TileMatrixSet><TileMatrixSetLimits>
<TileMatrixLimits><TileMatrix>6</TileMatrix></TileMatrixLimits><TileMatrixLimits><TileMatrix>18</TileMatrix></TileMatrixLimits></TileMatrixSetLimits></TileMatrixSetLink></Layer></Contents>`
