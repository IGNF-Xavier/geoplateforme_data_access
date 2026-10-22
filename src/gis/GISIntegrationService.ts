import { defaultLayer, groupByLayer } from './capabilities'
import { genericAdapter } from './adapters/generic'
import { qgisAdapter } from './adapters/qgis'
import type { GisAction, GisClientAdapter, GisInput, LayerAccess } from './types'

export interface GisOptions {
  /** Couches utilisables dans un SIG (au moins un service WMTS/WMS/WFS), avec mode recommandé. */
  layers: LayerAccess[]
  selectedLayer?: string
  clients: { id: string; label: string; instructions: string[]; actions: GisAction[] }[]
}

/**
 * Point d'entrée de « Utiliser dans un logiciel SIG ». Ajouter un logiciel =
 * écrire un `GisClientAdapter` et l'enregistrer ici.
 */
export class GISIntegrationService {
  constructor(private readonly adapters: GisClientAdapter[] = [qgisAdapter, genericAdapter]) {}

  getOptions(input: GisInput): GisOptions {
    const layers = groupByLayer(input.availableServices)
    if (layers.length === 0) return { layers, clients: [] }
    const selectedLayer = input.selectedLayer ?? defaultLayer(layers)?.layer
    const resolved = { ...input, selectedLayer }
    return {
      layers,
      selectedLayer,
      clients: this.adapters
        .map((a) => ({ id: a.id, label: a.label, instructions: a.instructions, actions: a.actions(resolved) }))
        .filter((c) => c.actions.length > 0),
    }
  }
}

export const gisIntegration = new GISIntegrationService()
