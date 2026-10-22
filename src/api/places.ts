/**
 * Recherche de lieux et limites administratives.
 *
 * - Géocodage : GET https://data.geopf.fr/geocodage/search?q=&type=municipality
 *   (doc : https://data.geopf.fr/geocodage/swagger-ui/index.html). Réponse GeoJSON,
 *   propriétés `label`, `type`, `citycode`, `context`.
 * - Limites administratives : WFS https://data.geopf.fr/wfs/ows, couches
 *   `ADMINEXPRESS-COG.LATEST:{commune,departement,region}`, en GET uniquement
 *   (le POST est refusé par la passerelle : HTTP 500). Les filtres spatiaux passent
 *   par CQL_FILTER `INTERSECTS(geometrie, SRID=4326;WKT)` avec WKT en lon/lat ;
 *   la sortie GeoJSON est en lon/lat (EPSG:4326).
 */
import type { AdminZone, Place } from '../types'
import { shrinkGeometry, simplifyForQuery, toWkt, type Geometry } from '../utils/geo'
import { fetchJson, type RequestOptions } from './http'

export const GEOCODING_URL = 'https://data.geopf.fr/geocodage/search'
export const WFS_URL = 'https://data.geopf.fr/wfs/ows'

interface GeocodeCollection {
  features?: {
    geometry: { coordinates: [number, number] }
    properties: { label?: string; type?: string; citycode?: string; context?: string }
  }[]
}

export function parsePlaces(response: GeocodeCollection): Place[] {
  return (response.features ?? []).flatMap((f) => {
    const [lon, lat] = f.geometry?.coordinates ?? []
    if (!f.properties?.label || !Number.isFinite(lon) || !Number.isFinite(lat)) return []
    return [
      {
        label: f.properties.label,
        kind: f.properties.type ?? 'unknown',
        citycode: f.properties.type === 'municipality' ? f.properties.citycode : undefined,
        lon,
        lat,
        context: f.properties.context,
      },
    ]
  })
}

export async function searchPlaces(query: string, options: RequestOptions = {}): Promise<Place[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const params = new URLSearchParams({ q, limit: '6', type: 'municipality' })
  return parsePlaces(await fetchJson<GeocodeCollection>(`${GEOCODING_URL}?${params}`, options))
}

interface FeatureCollection<P> {
  features?: { geometry: Geometry | null; properties: P }[]
}

function wfsUrl(params: Record<string, string>): string {
  return `${WFS_URL}?${new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    OUTPUTFORMAT: 'application/json',
    ...params,
  })}`
}

/** Contour (WGS84) d'une commune à partir de son code INSEE. */
export async function getCommuneGeometry(citycode: string, options: RequestOptions = {}): Promise<Geometry | undefined> {
  if (!/^[0-9AB]{5}$/.test(citycode)) return undefined
  const url = wfsUrl({
    TYPENAMES: 'ADMINEXPRESS-COG.LATEST:commune',
    SRSNAME: 'EPSG:4326',
    CQL_FILTER: `code_insee='${citycode}'`,
  })
  const response = await fetchJson<FeatureCollection<unknown>>(url, options)
  return response.features?.[0]?.geometry ?? undefined
}

/** Code de zone de l'API de téléchargement pour un département INSEE (`94` → `D094`, `2A` → `D02A`). */
export function departementZoneCode(codeInsee: string): string {
  return `D${codeInsee.padStart(3, '0')}`
}

export function regionZoneCode(codeInsee: string): string {
  return `R${codeInsee.padStart(2, '0')}`
}

interface DepProps {
  code_insee: string
  nom_officiel: string
  code_insee_de_la_region?: string
}

export function parseDepartements(response: FeatureCollection<DepProps>): { zones: AdminZone[]; regionCodes: string[] } {
  const features = response.features ?? []
  const zones = features.map<AdminZone>((f) => ({
    code: departementZoneCode(f.properties.code_insee),
    name: f.properties.nom_officiel,
    level: 'departement',
    parentRegion: f.properties.code_insee_de_la_region
      ? regionZoneCode(f.properties.code_insee_de_la_region)
      : undefined,
  }))
  const regionCodes = [
    ...new Set(features.map((f) => f.properties.code_insee_de_la_region).filter((c): c is string => !!c)),
  ]
  return { zones, regionCodes }
}

/**
 * Départements et régions dont le territoire rencontre la zone.
 * La géométrie est simplifiée (tolérance ≈ 20 m) pour tenir dans l'URL puis
 * rétrécie de 30 m : un simple contact de bordure avec un département voisin
 * n'est pas compté. Conséquence assumée : un dépassement de moins de ~30 m sur
 * un département voisin n'est pas détecté.
 */
export async function getAdminZonesIntersecting(
  geometry: Geometry,
  options: RequestOptions = {},
): Promise<AdminZone[]> {
  const filter = `INTERSECTS(geometrie,SRID=4326;${toWkt(simplifyForQuery(shrinkGeometry(simplifyForQuery(geometry, 400))))})`
  const depUrl = wfsUrl({
    TYPENAMES: 'ADMINEXPRESS-COG.LATEST:departement',
    PROPERTYNAME: 'code_insee,nom_officiel,code_insee_de_la_region',
    CQL_FILTER: filter,
  })
  const deps = parseDepartements(await fetchJson<FeatureCollection<DepProps>>(depUrl, options))

  const regions: AdminZone[] = []
  if (deps.regionCodes.length > 0) {
    const regUrl = wfsUrl({
      TYPENAMES: 'ADMINEXPRESS-COG.LATEST:region',
      PROPERTYNAME: 'code_insee,nom_officiel',
      CQL_FILTER: `code_insee IN (${deps.regionCodes.map((c) => `'${c}'`).join(',')})`,
    })
    const reg = await fetchJson<FeatureCollection<{ code_insee: string; nom_officiel: string }>>(regUrl, options)
    for (const f of reg.features ?? []) {
      regions.push({ code: regionZoneCode(f.properties.code_insee), name: f.properties.nom_officiel, level: 'region' })
    }
  }
  return [...deps.zones, ...regions]
}
