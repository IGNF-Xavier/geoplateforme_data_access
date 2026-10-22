import { describe, expect, it } from 'vitest'
import {
  areaSqm, bboxToPolygon, countVertices, createArea, formatArea, formatBBox, formatBytes, geometryBBox,
  intersectBBox, intersectsAnyExtent, isValidBBox, lambert93ToLonLat, lonLatToLambert93, shrinkGeometry,
  simplifyForQuery, toWkt, type Geometry,
} from '../src/utils/geo'
import type { BBox } from '../src/types'

describe('BBOX', () => {
  it('valide l’ordre minX<maxX et les bornes (pas d’inversion lon/lat)', () => {
    expect(isValidBBox([2.41, 48.83, 2.46, 48.86])).toBe(true)
    expect(isValidBBox([2.46, 48.83, 2.41, 48.86])).toBe(false)
    expect(isValidBBox([48.83, 2.41, 48.86, 2.46])).toBe(true) // valide en soi : (lon 48, lat 2) — la cohérence est de la responsabilité de l’appelant
    expect(isValidBBox([0, 95, 1, 96])).toBe(false)
    expect(isValidBBox([Number.NaN, 0, 1, 1])).toBe(false)
  })

  it('convertit une bbox en polygone fermé lon/lat', () => {
    const p = bboxToPolygon([2, 48, 3, 49])
    expect(p.coordinates[0]).toHaveLength(5)
    expect(p.coordinates[0][0]).toEqual([2, 48])
    expect(p.coordinates[0][2]).toEqual([3, 49])
    expect(geometryBBox(p)).toEqual([2, 48, 3, 49])
  })

  it('intersecte deux emprises, y compris en bordure et hors couverture', () => {
    const france: BBox = [-5.15, 41.32, 9.57, 51.1]
    expect(intersectBBox([2.4, 48.8, 2.5, 48.9], france)).toEqual([2.4, 48.8, 2.5, 48.9])
    expect(intersectBBox([9.57, 45, 10, 46], france)).toEqual([9.57, 45, 9.57, 46]) // contact exact
    expect(intersectBBox([10, 45, 11, 46], france)).toBeUndefined()
    expect(intersectsAnyExtent([-60, 15, -59, 16], [france])).toBe(false)
    expect(intersectsAnyExtent([-60, 15, -59, 16], [france, [-62, 15, -59.5, 16.6]])).toBe(true)
  })
})

describe('surface', () => {
  it('calcule une surface géodésique plausible (1 km × 1 km à Paris ≈ 1 km²)', () => {
    const lat = 48.85
    const dLat = 1 / 111.195
    const dLon = 1 / (111.195 * Math.cos((lat * Math.PI) / 180))
    const sqm = areaSqm(bboxToPolygon([2.35, lat, 2.35 + dLon, lat + dLat]))
    expect(sqm).toBeGreaterThan(0.98e6)
    expect(sqm).toBeLessThan(1.02e6)
  })

  it('formate surfaces et volumes en français', () => {
    expect(formatArea(500)).toBe('500 m²')
    expect(formatArea(25000)).toContain('ha')
    expect(formatArea(1.9e6)).toContain('km²')
    expect(formatBytes(260647898)).toMatch(/249\s?Mo/)
    expect(formatBytes(512)).toBe('512 o')
    expect(formatBBox([2, 48, 3, 49])).toContain('ouest 2.0000°')
  })

  it('crée une zone complète depuis une géométrie', () => {
    const a = createArea(bboxToPolygon([2.41, 48.83, 2.46, 48.86]), 'rectangle', 'Test')
    expect(a.areaSqm).toBeGreaterThan(0)
    expect(a.bbox).toEqual([2.41, 48.83, 2.46, 48.86])
  })
})

describe('reprojection', () => {
  it('Paris WGS84 → Lambert-93 (valeurs de référence IGN)', () => {
    const [x, y] = lonLatToLambert93([2.3522, 48.8566])
    expect(x).toBeGreaterThan(652000)
    expect(x).toBeLessThan(653000)
    expect(y).toBeGreaterThan(6861500)
    expect(y).toBeLessThan(6862500)
  })

  it('aller-retour sans dérive notable', () => {
    const [lon, lat] = lambert93ToLonLat(lonLatToLambert93([5.37, 43.3]))
    expect(lon).toBeCloseTo(5.37, 6)
    expect(lat).toBeCloseTo(43.3, 6)
  })
})

describe('polygones', () => {
  const circle = (n: number): Geometry => ({
    type: 'Polygon',
    coordinates: [Array.from({ length: n + 1 }, (_, i) => [2.4 + 0.02 * Math.cos((2 * Math.PI * (i % n)) / n), 48.85 + 0.02 * Math.sin((2 * Math.PI * (i % n)) / n)])],
  })

  it('écrit le WKT en x=lon puis y=lat', () => {
    expect(toWkt(bboxToPolygon([2, 48, 3, 49]))).toBe('POLYGON((2 48,3 48,3 49,2 49,2 48))')
    expect(toWkt({ type: 'MultiPolygon', coordinates: [bboxToPolygon([0, 0, 1, 1]).coordinates] })).toMatch(/^MULTIPOLYGON\(\(\(0 0/)
  })

  it('simplifie un polygone complexe sous la limite de sommets', () => {
    const big = circle(2000)
    expect(countVertices(big)).toBeGreaterThan(1000)
    expect(countVertices(simplifyForQuery(big, 120))).toBeLessThanOrEqual(120)
    const small = bboxToPolygon([2, 48, 3, 49])
    expect(simplifyForQuery(small, 120)).toEqual(small)
  })

  it('rétrécit une zone pour ignorer un simple contact de bordure, sans casser les petites zones', () => {
    const area = bboxToPolygon([2.4, 48.84, 2.43, 48.86])
    const shrunk = shrinkGeometry(area, 30)
    const [minX, , maxX] = geometryBBox(shrunk)
    expect(minX).toBeGreaterThan(2.4)
    expect(maxX).toBeLessThan(2.43)
    const tiny = bboxToPolygon([2.4, 48.84, 2.40005, 48.84005]) // quelques mètres : plus petit que 2×30 m
    expect(() => shrinkGeometry(tiny, 30)).not.toThrow()
    expect(countVertices(shrinkGeometry(tiny, 30))).toBeGreaterThan(0)
  })
})
