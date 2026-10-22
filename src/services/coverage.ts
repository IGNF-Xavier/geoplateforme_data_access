import type { Area, BBox, Dataset } from '../types'
import { intersectsAnyExtent } from '../utils/geo'

export interface Coverage {
  status: 'covered' | 'outside' | 'unknown'
  text: string
}

/**
 * Compare la zone à l'emprise d'un service ou d'une fiche. Comparaison de boîtes
 * englobantes : elle écarte un secteur manifestement hors couverture mais ne prouve
 * pas la présence de données sur chaque point (un territoire à trous reste « couvert »).
 * @param serviceBBox emprise annoncée par le service (prioritaire)
 */
export function checkCoverage(area: Area, dataset: Dataset, serviceBBox?: BBox): Coverage {
  const extents = serviceBBox ? [serviceBBox] : dataset.extents
  const source = serviceBBox ? 'l’emprise annoncée par le service' : 'l’emprise indiquée dans la fiche'
  if (extents.length === 0) {
    return { status: 'unknown', text: 'Ni le service ni la fiche n’annoncent d’emprise : impossible de vérifier que votre zone est couverte.' }
  }
  return intersectsAnyExtent(area.bbox, extents)
    ? { status: 'covered', text: `Votre zone est dans ${source} (comparaison de rectangles englobants).` }
    : { status: 'outside', text: `Votre zone est en dehors de ${source} : aucune donnée n’est attendue ici.` }
}
