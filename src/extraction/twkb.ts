/**
 * Encodage TWKB (Tiny WKB) d'un MultiPolygone. Le contour est recopié dans le filtre
 * de chaque table de la requête ; en WKT il pèse ~21 octets par sommet, en TWKB
 * hexadécimal ~4,5. Côté serveur : ST_SetSRID(ST_GeomFromTWKB(decode('…','hex')), srid)
 * — le TWKB ne porte pas de SRID. (Fonction vérifiée en conditions réelles sur le
 * service d'extraction lors du développement du plugin QGIS GPF Extraction.)
 *
 * Octet 1 : type (6 multipolygone) | précision zigzag << 4 ; octet 2 : 0 ;
 * puis nombre de polygones, d'anneaux, et par anneau nombre de points + points en
 * différences entières (zigzag + varint). Le point de fermeture est omis. Arithmétique
 * sans opérateurs binaires : ils tronquent à 32 bits.
 */
type Ring = number[][]
export type PolygonCoords = Ring[]

const zigzag = (n: number) => (n >= 0 ? 2 * n : -2 * n - 1)

function pushVarint(out: number[], n: number): void {
  while (n >= 128) {
    out.push((n % 128) + 128)
    n = Math.floor(n / 128)
  }
  out.push(n)
}

export function encodeTwkb(polygons: PolygonCoords[], precision = 6): number[] {
  if (precision < -8 || precision > 7) throw new RangeError('précision TWKB hors de -8..7')
  const scale = 10 ** precision
  const out: number[] = [6 | ((zigzag(precision) & 0x0f) << 4), 0]
  let px = 0
  let py = 0
  pushVarint(out, polygons.length)
  for (const rings of polygons) {
    pushVarint(out, rings.length)
    for (const ring of rings) {
      const points = ring.slice(0, -1)
      pushVarint(out, points.length)
      for (const [x, y] of points) {
        const ix = Math.round(x * scale)
        const iy = Math.round(y * scale)
        pushVarint(out, zigzag(ix - px))
        pushVarint(out, zigzag(iy - py))
        px = ix
        py = iy
      }
    }
  }
  return out
}

export const twkbHex = (polygons: PolygonCoords[], precision = 6): string =>
  encodeTwkb(polygons, precision)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

/** Décodeur de contrôle (tests) : [polygone][anneau][[x, y]…], anneaux refermés. */
export function decodeTwkb(bytes: number[]): PolygonCoords[] {
  const zz = bytes[0] >> 4
  const scale = 10 ** ((zz >> 1) ^ -(zz & 1))
  let pos = 2
  let px = 0
  let py = 0
  const varint = () => {
    let result = 0
    let mul = 1
    for (;;) {
      const b = bytes[pos++]
      result += (b & 0x7f) * mul
      if (!(b & 0x80)) return result
      mul *= 128
    }
  }
  const unzigzag = (n: number) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2)
  const polygons: PolygonCoords[] = []
  for (let n = varint(); n > 0; n--) {
    const rings: PolygonCoords = []
    for (let r = varint(); r > 0; r--) {
      const ring: Ring = []
      for (let k = varint(); k > 0; k--) {
        px += unzigzag(varint())
        py += unzigzag(varint())
        ring.push([px / scale, py / scale])
      }
      ring.push(ring[0])
      rings.push(ring)
    }
    polygons.push(rings)
  }
  return polygons
}
