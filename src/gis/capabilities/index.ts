import type { ServiceAccess, ServiceKind } from '../../types'
import type { LayerAccess } from '../types'

/**
 * Ordre de recommandation, avec ses raisons explicites :
 *  - WMTS : images pré-calculées et mises en cache → affichage le plus rapide ;
 *  - WMS  : image générée à la demande, toute projection → repli si pas de WMTS ;
 *  - WFS  : géométries et attributs (interrogeables, modifiables) → seul mode
 *           « vecteur » ; recommandé s'il n'existe aucun service d'image ;
 *  - TMS  : tuiles vectorielles, non exploité par l'application.
 */
const ORDER: { kind: ServiceKind; reason: string }[] = [
  { kind: 'WMTS', reason: 'Tuiles pré-calculées : affichage le plus rapide.' },
  { kind: 'WMS', reason: 'Image générée à la demande (pas de WMTS pour cette couche).' },
  { kind: 'WFS', reason: 'Seul accès aux entités vectorielles pour cette couche.' },
  { kind: 'TMS', reason: 'Seul accès disponible : tuiles vectorielles (TMS), à utiliser dans un client qui les gère.' },
]

/** Protocoles proposés en SIG (TMS : URL à copier seulement, QGIS ne le charge pas via un .qlr généré ici). */
export const GIS_USABLE_KINDS: ServiceKind[] = ['WMTS', 'WMS', 'WFS', 'TMS']

/** Services exploitables : protocole supporté ET accès ouvert (les offres réservées exigent des droits). */
export function usableServices(services: ServiceAccess[]): ServiceAccess[] {
  return services.filter((s) => GIS_USABLE_KINDS.includes(s.kind) && !s.restricted)
}

export const restrictedServices = (services: ServiceAccess[]): ServiceAccess[] => services.filter((s) => s.restricted)

/** Regroupe par nom de couche et désigne le mode recommandé de chacune. */
export function groupByLayer(services: ServiceAccess[]): LayerAccess[] {
  const byLayer = new Map<string, ServiceAccess[]>()
  for (const s of usableServices(services)) {
    byLayer.set(s.layer, [...(byLayer.get(s.layer) ?? []), s])
  }
  return [...byLayer].map(([layer, list]) => {
    const best = ORDER.find((o) => list.some((s) => s.kind === o.kind))!
    return { layer, services: list, recommended: list.find((s) => s.kind === best.kind)!, reason: best.reason }
  })
}

/** Couche proposée par défaut : la première couche disposant d'un service d'image (WMTS > WMS), sinon la première. */
export function defaultLayer(layers: LayerAccess[]): LayerAccess | undefined {
  for (const kind of ['WMTS', 'WMS'] as ServiceKind[]) {
    const hit = layers.find((l) => l.recommended.kind === kind)
    if (hit) return hit
  }
  return layers[0]
}

/** Valide une URL de service avant de l'intégrer à un fichier ou à une commande : https uniquement, sans identifiants. */
export function validateServiceUrl(raw: string): URL {
  if (/[\s\u0000-\u001f<>"'`]/.test(raw)) throw new Error('URL de service invalide (caractères interdits).')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('URL de service invalide.')
  }
  if (url.protocol !== 'https:') throw new Error(`Protocole non supporté : ${url.protocol}`)
  if (url.username || url.password) throw new Error('Les identifiants dans l’URL ne sont pas acceptés.')
  return url
}
