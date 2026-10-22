/**
 * Génération de sources de données et de fichiers de définition de couche QGIS
 * (.qlr). Le .qlr est un format natif de QGIS (« Layer Definition File »),
 * ouvrable par glisser-déposer sur la carte ou via Couche > Ajouter depuis un
 * fichier de définition de couche : aucun plugin n'est requis.
 *
 * Sécurité : ce module ne produit que des données (URI + XML échappé). Aucun code
 * Python ni commande n'est généré ; les URLs sont validées (https uniquement).
 */
import type { WmtsLayerInfo } from '../../api/wmts'
import type { ServiceAccess } from '../../types'
import { validateServiceUrl } from '../capabilities'

export const WMTS_CAPABILITIES_QUERY = 'SERVICE%3DWMTS%26REQUEST%3DGetCapabilities'

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Valeur entre apostrophes dans une URI de fournisseur QGIS (WFS). */
const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

export type QgisProvider = 'wms' | 'WFS'

export interface QgisSource {
  provider: QgisProvider
  /** `raster` pour WMS/WMTS, `vector` pour WFS. */
  layerType: 'raster' | 'vector'
  uri: string
  name: string
}

/** Construit l'URI de source de données QGIS d'un accès (WMS, WMTS, WFS). */
export function qgisSource(access: ServiceAccess, title: string, wmts?: WmtsLayerInfo): QgisSource {
  const endpoint = validateServiceUrl(access.endpoint).toString()

  switch (access.kind) {
    case 'WMS': {
      const uri = new URLSearchParams({
        contextualWMSLegend: '0',
        crs: 'EPSG:3857',
        dpiMode: '7',
        featureCount: '10',
        format: 'image/png',
        layers: access.layer,
        styles: '',
        url: endpoint,
      })
      return { provider: 'wms', layerType: 'raster', uri: qgisKvp(uri), name: title }
    }
    case 'WMTS': {
      if (!wmts) throw new Error('Les paramètres WMTS (style, format, jeu de tuiles) sont requis.')
      const uri = [
        ['crs', 'EPSG:3857'],
        ['dpiMode', '7'],
        ['format', wmts.format],
        ['layers', access.layer],
        ['styles', wmts.style],
        ['tileMatrixSet', wmts.tileMatrixSet],
        ['url', `${endpoint}?${WMTS_CAPABILITIES_QUERY}`],
      ]
        .map(([k, v]) => `${k}=${v}`)
        .join('&')
      return { provider: 'wms', layerType: 'raster', uri, name: title }
    }
    case 'WFS': {
      const uri = [
        `pagingEnabled='default'`,
        `restrictToRequestBBOX='1'`,
        `srsname='EPSG:4326'`,
        `typename=${quote(access.layer)}`,
        `url=${quote(endpoint)}`,
        `version='auto'`,
      ].join(' ')
      return { provider: 'WFS', layerType: 'vector', uri, name: title }
    }
    default:
      throw new Error(`Protocole non supporté par QGIS dans cette application : ${access.kind}`)
  }
}

/** Sérialise des paramètres à la manière des URI QGIS : `:` et `/` non encodés, `url` laissée brute. */
function qgisKvp(params: URLSearchParams): string {
  return [...params].map(([k, v]) => (k === 'url' ? `${k}=${v}` : `${k}=${encodeURIComponent(v).replace(/%3A/g, ':').replace(/%2F/g, '/')}`)).join('&')
}

const WEB_MERCATOR_SRS = `<spatialrefsys nativeFormat="Wkt"><wkt>PROJCRS["WGS 84 / Pseudo-Mercator",BASEGEOGCRS["WGS 84",DATUM["World Geodetic System 1984",ELLIPSOID["WGS 84",6378137,298.257223563,LENGTHUNIT["metre",1]]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]]],CONVERSION["Popular Visualisation Pseudo-Mercator",METHOD["Popular Visualisation Pseudo Mercator",ID["EPSG",1024]],PARAMETER["Latitude of natural origin",0,ANGLEUNIT["degree",0.0174532925199433]],PARAMETER["Longitude of natural origin",0,ANGLEUNIT["degree",0.0174532925199433]],PARAMETER["False easting",0,LENGTHUNIT["metre",1]],PARAMETER["False northing",0,LENGTHUNIT["metre",1]]],CS[Cartesian,2],AXIS["easting (X)",east,ORDER[1],LENGTHUNIT["metre",1]],AXIS["northing (Y)",north,ORDER[2],LENGTHUNIT["metre",1]],USAGE[SCOPE["Web mapping and visualisation."],AREA["World between 85.06°S and 85.06°N."],BBOX[-85.06,-180,85.06,180]],ID["EPSG",3857]]</wkt><authid>EPSG:3857</authid></spatialrefsys>`

const WGS84_SRS = `<spatialrefsys nativeFormat="Wkt"><authid>EPSG:4326</authid></spatialrefsys>`

let counter = 0

/** Contenu d'un fichier .qlr regroupant une ou plusieurs couches. */
export function buildQlr(sources: QgisSource[]): string {
  const ids = sources.map((s, i) => `${s.provider}_${Date.now().toString(36)}_${i}_${counter++}`)
  const tree = sources
    .map(
      (s, i) =>
        `  <layer-tree-layer id="${ids[i]}" name="${escapeXml(s.name)}" source="${escapeXml(s.uri)}" providerKey="${s.provider}" checked="Qt::Checked" expanded="1">\n   <customproperties/>\n  </layer-tree-layer>`,
    )
    .join('\n')
  const layers = sources
    .map(
      (s, i) =>
        ` <maplayer type="${s.layerType}"${s.layerType === 'vector' ? ' geometry="Unknown"' : ''}>\n  <id>${ids[i]}</id>\n  <datasource>${escapeXml(s.uri)}</datasource>\n  <layername>${escapeXml(s.name)}</layername>\n  <srs>${s.layerType === 'raster' ? WEB_MERCATOR_SRS : WGS84_SRS}</srs>\n  <provider>${s.provider}</provider>\n </maplayer>`,
    )
    .join('\n')
  return `<!DOCTYPE qgis-layer-definition>\n<qlr>\n <layer-tree-group name="" checked="Qt::Checked" expanded="1">\n  <customproperties/>\n${tree}\n </layer-tree-group>\n <maplayers>\n${layers}\n </maplayers>\n</qlr>\n`
}

export function qlrFileName(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  return `${slug || 'donnee'}.qlr`
}
