import type { AtomFile, Job, ProcessDetails, StoredData } from '../extraction/models'
import type { ProcessMatch } from '../extraction/builder'
import type { ExtractionPlan } from '../extraction/builder'
import type { ResolveResult } from '../services/resources'
import type { Analysis } from '../search/analyze'
import type { SemanticProgress, SemanticStatus } from '../search/semantic'
import type { AdminZone, Area, AsyncState, Dataset, Place } from '../types'

export type GetTab = 'download' | 'gis' | 'extract'

export interface Filters {
  downloadable: boolean
  gis: boolean
  openOnly: boolean
}

export interface ExtractionState {
  /** Liste des produits d'extraction du compte (exige une connexion). */
  processes: AsyncState<ProcessMatch[]>
  processId?: string
  /** Détails du produit choisi : champs, tables, projection native. */
  details: AsyncState<{ process: ProcessDetails; stored: StoredData }>
  selectedTables: string[]
  values: Record<string, unknown>
  job?: Job
  logs?: string
  files?: AtomFile[]
  /** Dernière requête construite (affichage du contour réellement envoyé). */
  plan?: ExtractionPlan
  /** Erreur de lancement ou de suivi, avec rapport copiable éventuel. */
  error?: { message: string; report?: string }
  launching: boolean
}

export interface GisResult {
  kind: 'loading' | 'success' | 'error' | 'warning'
  title: string
  text?: string
  /** Texte copiable affiché dans un bloc de code. */
  code?: string
}

/** Résultat de la comparaison zone ↔ emprise d'un service ou d'une fiche. */
export interface CoverageState {
  status: 'idle' | 'loading' | 'covered' | 'outside' | 'unknown'
  text?: string
}

export interface AppState {
  /** Bandeau des besoins déplié : par défaut tant qu'aucune recherche n'a été faite, puis replié (au choix de l'utilisateur). */
  needsOpen: boolean
  /** Recherche sémantique locale (modèle dans le navigateur) : activée par l'utilisateur. */
  semantic: { enabled: boolean; status: SemanticStatus; progress: SemanticProgress; error?: string; added: number; boosted: number }
  tab: GetTab
  /** Outils de définition de la zone dépliés. */
  zoneOpen: boolean
  coverage?: CoverageState
  query: string
  filters: Filters
  search: AsyncState<{ datasets: Dataset[]; analysis: Analysis; catalogueTotal: number; indexCount: number; failures: string[] }>
  dataset?: Dataset
  /** Couche (nom de service) affichée en aperçu et utilisée pour les accès SIG. */
  layer?: string
  preview: AsyncState<undefined>
  area?: Area
  places: AsyncState<Place[]>
  adminZones: AsyncState<AdminZone[]>
  /** Ressource de téléchargement choisie quand le produit en propose plusieurs (ex. BD TOPO / BD TOPO EXPRESS). */
  resourceId?: string
  format?: string
  date?: string
  download: AsyncState<ResolveResult>
  drawing?: 'rectangle' | 'polygon'
  /** Message ponctuel lié à la zone (contour introuvable, coordonnées invalides…). */
  areaMessage?: string
  gis: { result?: GisResult }
  extraction: ExtractionState
  /** Connexion : incrémenté à chaque changement du jeton, pour redessiner. */
  authVersion: number
  panelCollapsed: boolean
}

export const initialExtraction: ExtractionState = {
  processes: { status: 'idle' },
  details: { status: 'idle' },
  selectedTables: [],
  values: {},
  launching: false,
}

export const initialState: AppState = {
  needsOpen: true,
  semantic: { enabled: false, status: 'off', progress: { percent: 0, label: '' }, added: 0, boosted: 0 },
  tab: 'gis',
  zoneOpen: false,
  query: '',
  filters: { downloadable: false, gis: false, openOnly: false },
  search: { status: 'idle' },
  preview: { status: 'idle' },
  places: { status: 'idle' },
  adminZones: { status: 'idle' },
  download: { status: 'idle' },
  gis: {},
  extraction: initialExtraction,
  authVersion: 0,
  panelCollapsed: false,
}

type Listener = (state: AppState, prev: AppState) => void

export class Store {
  private state: AppState = { ...initialState }
  private listeners = new Set<Listener>()

  get(): AppState {
    return this.state
  }

  set(patch: Partial<AppState>): void {
    const prev = this.state
    this.state = { ...prev, ...patch }
    this.listeners.forEach((l) => l(this.state, prev))
  }

  patchExtraction(patch: Partial<ExtractionState>): void {
    this.set({ extraction: { ...this.state.extraction, ...patch } })
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
