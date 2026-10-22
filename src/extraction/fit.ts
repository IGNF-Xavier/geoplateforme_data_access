/**
 * Adapte le contour de la zone à la taille acceptée par le service (cf. config.ts :
 * budget de 200 Ko pour toute la requête, contour recopié dans chaque table).
 * Stratégie, du plus fidèle au plus léger ; chaque étape RECOUVRE la zone (on peut
 * récupérer un peu plus de données, jamais moins) :
 *   1. contour précis ;
 *   2. contour simplifié (Douglas-Peucker) puis élargi de sa tolérance ;
 *   3. rectangle englobant (ST_MakeEnvelope).
 */
import buffer from '@turf/buffer'
import simplify from '@turf/simplify'
import type { Feature } from 'geojson'
import { countVertices, geometryBBox, type Geometry } from '../utils/geo'
import { isGeographic, projectGeometry } from './srs'
import { twkbHex, type PolygonCoords } from './twkb'

export const WRAPPER_BYTES = 80
export const TOLERANCES_M = [10, 25, 50, 100, 250]

export type FitMode = 'precise' | 'simplified' | 'bbox'

export interface FittedExtent {
  /** Expression SQL du contour, dans la projection native. */
  expression: string
  mode: FitMode
  /** Tolérance (m) de simplification, si `mode === 'simplified'`. */
  toleranceM?: number
  /** Octets de l'expression. */
  bytes: number
}

const polygons = (g: Geometry): PolygonCoords[] => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)

function toExpression(geometry: Geometry, srid: number, coarse: boolean): string {
  const projected = projectGeometry(geometry, srid)
  const precision = isGeographic(srid) ? (coarse ? 5 : 6) : coarse ? 0 : 2
  return `ST_SetSRID(ST_GeomFromTWKB(decode('${twkbHex(polygons(projected), precision)}','hex')), ${srid})`
}

export function bboxExpression(geometry: Geometry, srid: number): string {
  const [w, s, e, n] = geometryBBox(geometry)
  const corners = projectGeometry({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, srid)
  const ring = (corners as { coordinates: number[][][] }).coordinates[0]
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  const r = (v: number) => Math.round(v * 100) / 100
  return `ST_MakeEnvelope(${r(Math.min(...xs))}, ${r(Math.min(...ys))}, ${r(Math.max(...xs))}, ${r(Math.max(...ys))}, ${srid})`
}

/**
 * @param geometry zone en WGS84 (lon/lat)
 * @param srid projection native des tables
 * @param maxBytes taille maximale de l'expression (budget total ÷ nombre de tables)
 */
export function fitExtent(geometry: Geometry, srid: number, maxBytes: number): FittedExtent {
  const size = (e: string) => e.length + WRAPPER_BYTES
  const precise = toExpression(geometry, srid, false)
  if (size(precise) <= maxBytes) return { expression: precise, mode: 'precise', bytes: size(precise) }

  const feature: Feature<Geometry> = { type: 'Feature', properties: {}, geometry }
  for (const toleranceM of TOLERANCES_M) {
    const simplified = simplify(feature, { tolerance: toleranceM / 111_320, highQuality: false }).geometry
    if (countVertices(simplified) < 4) continue
    const grown = buffer({ type: 'Feature', properties: {}, geometry: simplified }, toleranceM / 1000, { units: 'kilometers' })
      ?.geometry as Geometry | undefined
    if (!grown) continue
    const expression = toExpression(grown, srid, true)
    if (size(expression) <= maxBytes) return { expression, mode: 'simplified', toleranceM, bytes: size(expression) }
  }
  const expression = bboxExpression(geometry, srid)
  return { expression, mode: 'bbox', bytes: size(expression) }
}
