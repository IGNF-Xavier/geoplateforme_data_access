/**
 * Utilitaires géographiques. Convention de tout le code : les coordonnées
 * « métier » sont en WGS84, ordre [lon, lat] (GeoJSON). L'ordre lat/lon n'est
 * utilisé que lorsqu'un service l'exige, localement et explicitement.
 */
import area from '@turf/area'
import bboxOf from '@turf/bbox'
import buffer from '@turf/buffer'
import simplify from '@turf/simplify'
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'
import proj4 from 'proj4'
import type { Area, BBox } from '../types'

proj4.defs('EPSG:2154', '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs')

export type Geometry = Polygon | MultiPolygon

export function bboxToPolygon([minX, minY, maxX, maxY]: BBox): Polygon {
  return {
    type: 'Polygon',
    coordinates: [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]],
  }
}

export function isValidBBox(b: BBox): boolean {
  const [minX, minY, maxX, maxY] = b
  return (
    b.every(Number.isFinite) &&
    minX < maxX &&
    minY < maxY &&
    minX >= -180 && maxX <= 180 &&
    minY >= -90 && maxY <= 90
  )
}

/** Surface géodésique (m²) — Turf, calcul sphérique. */
export function areaSqm(geometry: Geometry): number {
  return area({ type: 'Feature', properties: {}, geometry })
}

export function geometryBBox(geometry: Geometry): BBox {
  return bboxOf(geometry) as BBox
}

export function createArea(geometry: Geometry, source: Area['source'], label: string): Area {
  return { geometry, bbox: geometryBBox(geometry), areaSqm: areaSqm(geometry), source, label }
}

/** Intersection de deux boîtes englobantes ; `undefined` si elles ne se touchent pas. */
export function intersectBBox(a: BBox, b: BBox): BBox | undefined {
  const r: BBox = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]
  return r[0] <= r[2] && r[1] <= r[3] ? r : undefined
}

export function bboxesIntersect(a: BBox, b: BBox): boolean {
  return intersectBBox(a, b) !== undefined
}

/** Vrai si `area` rencontre au moins une des étendues déclarées. */
export function intersectsAnyExtent(areaBBox: BBox, extents: BBox[]): boolean {
  return extents.some((e) => bboxesIntersect(areaBBox, e))
}

export function countVertices(geometry: Geometry): number {
  const rings = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return rings.reduce((n, poly) => n + poly.reduce((m, ring) => m + ring.length, 0), 0)
}

/**
 * Réduit une géométrie à au plus `maxVertices` sommets (Douglas-Peucker, tolérance
 * croissante) pour tenir dans une URL de requête WFS. Utilisé uniquement pour
 * interroger les limites administratives, jamais pour la zone affichée.
 */
export function simplifyForQuery(geometry: Geometry, maxVertices = 120): Geometry {
  if (countVertices(geometry) <= maxVertices) return roundGeometry(geometry)
  let tolerance = 0.0002
  let current: Geometry = geometry
  for (let i = 0; i < 12 && countVertices(current) > maxVertices; i++) {
    const feature: Feature<Geometry> = { type: 'Feature', properties: {}, geometry: geometry }
    current = simplify(feature, { tolerance, highQuality: false, mutate: false }).geometry
    tolerance *= 2
  }
  if (countVertices(current) > maxVertices) return bboxToPolygon(geometryBBox(geometry))
  return roundGeometry(current)
}

/**
 * Rétrécit la géométrie de `meters` pour ignorer les contacts de simple bordure
 * (commune dont la limite coïncide avec celle d'un département voisin). Si la
 * géométrie est trop petite pour être rétrécie, elle est renvoyée telle quelle.
 */
export function shrinkGeometry(geometry: Geometry, meters = 30): Geometry {
  try {
    const shrunk = buffer({ type: 'Feature', properties: {}, geometry }, -meters / 1000, { units: 'kilometers' })
    const result = shrunk?.geometry as Geometry | undefined
    return result && countVertices(result) > 0 ? result : geometry
  } catch {
    return geometry
  }
}

function roundGeometry(geometry: Geometry): Geometry {
  const r = (p: Position): Position => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]
  if (geometry.type === 'Polygon') return { type: 'Polygon', coordinates: geometry.coordinates.map((ring) => ring.map(r)) }
  return {
    type: 'MultiPolygon',
    coordinates: geometry.coordinates.map((poly) => poly.map((ring) => ring.map(r))),
  }
}

/** WKT `POLYGON((lon lat, …))` — ordre x=lon, y=lat, aligné sur `SRID=4326;` côté GeoServer. */
export function toWkt(geometry: Geometry): string {
  const ring = (r: Position[]) => `(${r.map(([x, y]) => `${x} ${y}`).join(',')})`
  const poly = (p: Position[][]) => `(${p.map(ring).join(',')})`
  return geometry.type === 'Polygon'
    ? `POLYGON${poly(geometry.coordinates)}`
    : `MULTIPOLYGON(${geometry.coordinates.map(poly).join(',')})`
}

export function lonLatToLambert93([lon, lat]: [number, number]): [number, number] {
  return proj4('EPSG:4326', 'EPSG:2154', [lon, lat]) as [number, number]
}

export function lambert93ToLonLat([x, y]: [number, number]): [number, number] {
  return proj4('EPSG:2154', 'EPSG:4326', [x, y]) as [number, number]
}

export function formatArea(sqm: number): string {
  if (sqm >= 1e6) return `${(sqm / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: sqm >= 1e8 ? 0 : 1 })} km²`
  if (sqm >= 1e4) return `${(sqm / 1e4).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ha`
  return `${Math.round(sqm).toLocaleString('fr-FR')} m²`
}

export function formatBytes(bytes: number): string {
  const units = ['o', 'Ko', 'Mo', 'Go', 'To']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: v >= 100 || i === 0 ? 0 : 1 })} ${units[i]}`
}

export function formatBBox(b: BBox): string {
  const f = (n: number) => n.toFixed(4)
  return `ouest ${f(b[0])}°, sud ${f(b[1])}°, est ${f(b[2])}°, nord ${f(b[3])}°`
}
