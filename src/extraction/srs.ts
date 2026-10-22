import proj4 from 'proj4'
import type { Geometry } from '../utils/geo'

/**
 * Projections « natives » des données stockées de la Géoplateforme : métropole
 * (EPSG:2154) et outre-mer (UTM RGAF09/RGFG95/RGR92/RGM04/RGSPM06). Toute autre
 * projection est refusée explicitement (mode non géré : l'extraction n'est pas lancée).
 */
const UTM = (zone: number, south = false) =>
  `+proj=utm +zone=${zone}${south ? ' +south' : ''} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`

const DEFS: Record<number, string> = {
  4326: '+proj=longlat +datum=WGS84 +no_defs',
  2154: '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs',
  5490: UTM(20), // Antilles (RGAF09)
  2972: UTM(22), // Guyane (RGFG95)
  2975: UTM(40, true), // La Réunion (RGR92)
  4471: UTM(38, true), // Mayotte (RGM04)
  4467: UTM(21), // Saint-Pierre-et-Miquelon (RGSPM06)
}

export function parseSrid(srs: string): number | undefined {
  const m = /(\d{4,5})\s*$/.exec(srs.trim())
  return m ? Number(m[1]) : undefined
}

export const isSupportedSrid = (srid: number | undefined): srid is number => srid !== undefined && srid in DEFS
export const isGeographic = (srid: number) => srid === 4326

export function projectGeometry(geometry: Geometry, srid: number): Geometry {
  if (!isSupportedSrid(srid)) throw new Error(`Projection native EPSG:${srid} non gérée.`)
  const def = DEFS[srid]
  const pt = (p: number[]) => proj4(DEFS[4326], def, [p[0], p[1]])
  const ring = (r: number[][]) => r.map(pt)
  return geometry.type === 'Polygon'
    ? { type: 'Polygon', coordinates: geometry.coordinates.map(ring) }
    : { type: 'MultiPolygon', coordinates: geometry.coordinates.map((p) => p.map(ring)) }
}
