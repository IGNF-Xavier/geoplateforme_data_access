import type { Area, Dataset, ServiceAccess } from '../types'

/** Ce que l'on sait d'une donnée au moment d'« utiliser dans un logiciel ». */
export interface GisInput {
  resource: Dataset
  availableServices: ServiceAccess[]
  selectedArea?: Area
  /** Couche (nom de service) choisie par l'utilisateur ; sinon la recommandée. */
  selectedLayer?: string
}

/** Résultat produit par une action : un fichier à enregistrer ou un texte à copier. */
export type GisOutput =
  | { kind: 'file'; fileName: string; mimeType: string; content: string }
  | { kind: 'text'; text: string }

export interface GisAction {
  id: string
  label: string
  description: string
  /** Protocole sous-jacent, pour l'affichage avancé uniquement. */
  protocol: string
  run(signal?: AbortSignal): Promise<GisOutput>
}

export interface GisClientAdapter {
  id: string
  label: string
  /** Texte d'aide affiché une fois l'action réalisée (ce qui reste à faire par l'utilisateur). */
  instructions: string[]
  actions(input: GisInput): GisAction[]
}

export interface LayerAccess {
  layer: string
  services: ServiceAccess[]
  recommended: ServiceAccess
  /** Raison, vérifiable, du choix du mode recommandé. */
  reason: string
}
