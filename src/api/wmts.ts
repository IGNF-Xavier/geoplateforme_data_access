/**
 * Lecture ciblée du GetCapabilities WMTS de la Géoplateforme
 * (https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities, ≈ 3 Mo, mis en
 * cache mémoire). Sert à connaître, pour UNE couche, son style par défaut, son
 * format et son jeu de tuiles — informations indispensables à OpenLayers et à QGIS
 * et absentes du catalogue.
 */
import { ApiError } from './http'

export interface WmtsLayerInfo {
  layer: string
  style: string
  format: string
  tileMatrixSet: string
  minZoom?: number
  maxZoom?: number
  /** Emprise annoncée par le service (WGS84 : ouest, sud, est, nord). */
  bbox?: [number, number, number, number]
}

const cache = new Map<string, Promise<string>>()

async function loadCapabilities(url: string, signal?: AbortSignal): Promise<string> {
  let pending = cache.get(url)
  if (!pending) {
    pending = fetch(url, { signal })
      .then((r) => {
        if (!r.ok) throw new ApiError('http', `Le service WMTS a répondu avec le code ${r.status}.`, r.status, url)
        return r.text()
      })
      .catch((e) => {
        cache.delete(url)
        if (e instanceof ApiError) throw e
        if (signal?.aborted) throw new ApiError('aborted', 'Requête annulée.', undefined, url)
        throw new ApiError('network', 'Le service WMTS est injoignable.', undefined, url)
      })
    cache.set(url, pending)
  }
  return pending
}

function tag(block: string, name: string): string | undefined {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1]?.trim()
}

/** Extrait la description d'une couche du XML de capacités (sans parser les 3 Mo en DOM). */
export function parseWmtsLayer(xml: string, layer: string): WmtsLayerInfo | undefined {
  const marker = `<ows:Identifier>${layer}</ows:Identifier>`
  // Les identifiants de styles portent parfois le même nom que la couche : on
  // cherche l'identifiant situé avant le premier <Style>, donc au niveau couche.
  let from = 0
  let block: string | undefined
  while (block === undefined) {
    const idx = xml.indexOf(marker, from)
    if (idx === -1) return undefined
    const start = xml.lastIndexOf('<Layer>', idx)
    const end = xml.indexOf('</Layer>', idx)
    const candidate = start >= 0 && end > start ? xml.slice(start, end) : ''
    const firstStyle = candidate.indexOf('<Style')
    if (candidate && (firstStyle === -1 || candidate.indexOf(marker) < firstStyle)) block = candidate
    from = idx + marker.length
  }

  const defaultStyle = /<Style isDefault="true">[\s\S]*?<ows:Identifier>([^<]+)<\/ows:Identifier>/.exec(block)?.[1]
  const style = defaultStyle ?? /<Style[^>]*>[\s\S]*?<ows:Identifier>([^<]+)<\/ows:Identifier>/.exec(block)?.[1]
  const format = tag(block, 'Format')
  const tileMatrixSet = tag(block, 'TileMatrixSet')
  if (!style || !format || !tileMatrixSet) return undefined

  const lower = /<ows:LowerCorner>([-\d.eE+]+) ([-\d.eE+]+)<\/ows:LowerCorner>/.exec(block)
  const upper = /<ows:UpperCorner>([-\d.eE+]+) ([-\d.eE+]+)<\/ows:UpperCorner>/.exec(block)
  const bbox = lower && upper ? ([Number(lower[1]), Number(lower[2]), Number(upper[1]), Number(upper[2])] as [number, number, number, number]) : undefined
  const zooms = [...block.matchAll(/<TileMatrix>(\d+)<\/TileMatrix>/g)].map((m) => Number(m[1]))
  return {
    layer,
    style,
    format,
    tileMatrixSet,
    minZoom: zooms.length ? Math.min(...zooms) : undefined,
    maxZoom: zooms.length ? Math.max(...zooms) : undefined,
    bbox,
  }
}

export async function describeWmtsLayer(
  capabilitiesUrl: string,
  layer: string,
  signal?: AbortSignal,
): Promise<WmtsLayerInfo | undefined> {
  return parseWmtsLayer(await loadCapabilities(capabilitiesUrl, signal), layer)
}

/** Gabarit d'URL KVP de tuiles, utilisable par OpenLayers (XYZ) car les jeux `PM*` suivent la grille Web Mercator. */
export function wmtsTileUrlTemplate(endpoint: string, info: WmtsLayerInfo): string {
  const p = new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: info.layer,
    STYLE: info.style,
    FORMAT: info.format,
    TILEMATRIXSET: info.tileMatrixSet,
  })
  return `${endpoint}?${p}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`
}
