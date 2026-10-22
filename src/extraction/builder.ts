/**
 * Construction du corps de requête d'extraction et rapprochement donnée ↔ produit.
 */
import type { Dataset } from '../types'
import type { Geometry } from '../utils/geo'
import { EXTRACTION_BUDGET_BYTES } from '../config'
import { fitExtent, type FittedExtent } from './fit'
import {
  OUTPUTS_NOT_REQUESTED, fieldDefault, fieldEnum, fieldType,
  type ProcessDetails, type ProcessField, type ProcessSummary, type StoredData, type StoredTable,
} from './models'
import { isSupportedSrid, parseSrid } from './srs'

/* ------------------------------------------------ rapprochement donnée ↔ produit */

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[®™]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'd', 'l', 'data', 'donnees'])
const tokens = (s: string) => normalize(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t))

export interface ProcessMatch {
  process: ProcessSummary
  /** Part des mots de la donnée retrouvés dans le produit (0–1). */
  score: number
}

/**
 * Le catalogue et le service d'extraction n'ont pas d'identifiant commun : le
 * rapprochement est une HEURISTIQUE sur les mots du titre et des identifiants de
 * ressource. L'utilisateur voit le produit retenu et peut en choisir un autre.
 */
export function matchProcesses(dataset: Pick<Dataset, 'title' | 'downloads'>, processes: ProcessSummary[]): ProcessMatch[] {
  const wanted = new Set([...tokens(dataset.title), ...dataset.downloads.flatMap((d) => tokens(d.id))])
  return processes
    .map((process) => {
      const have = new Set(tokens(`${process.title} ${process.id}`))
      const hit = [...wanted].filter((t) => have.has(t)).length
      return { process, score: wanted.size ? hit / wanted.size : 0 }
    })
    .sort((a, b) => b.score - a.score || a.process.title.localeCompare(b.process.title))
}

/* ------------------------------------------------------------------ requête */

export interface ExtractionPlan {
  body: { inputs: Record<string, unknown>; outputs: Record<string, object> }
  extent?: FittedExtent
  tables: number
  /** Taille du corps JSON envoyé, en octets. */
  bodyBytes: number
}

export function nativeSrid(stored: StoredData): number | undefined {
  const srid = parseSrid(stored.srs)
  return isSupportedSrid(srid) ? srid : undefined
}

/**
 * @param values valeurs des champs génériques (format, srs, lifetime…), clé = id d'input
 * @throws si la projection native n'est pas gérée ou si aucune table n'est choisie
 */
export function buildExtractionPlan(
  process: ProcessDetails,
  stored: StoredData,
  tables: StoredTable[],
  area: Geometry,
  values: Record<string, unknown>,
  budget = EXTRACTION_BUDGET_BYTES,
): ExtractionPlan {
  const srid = nativeSrid(stored)
  if (!srid) throw new Error(`Projection native « ${stored.srs} » non gérée par cette application.`)
  if (tables.length === 0) throw new Error('Choisissez au moins une table.')

  // Le contour est recopié dans chaque table : budget partagé.
  const extent = fitExtent(area, srid, Math.floor(budget / tables.length))
  const relations: Record<string, { attributes: string[]; filters?: string }> = {}
  for (const table of tables) {
    const entry: { attributes: string[]; filters?: string } = { attributes: Object.keys(table.attributes) }
    if (table.geometryAttribute) entry.filters = `ST_Intersects(${table.geometryAttribute}, ${extent.expression})`
    relations[table.name] = entry
  }

  const inputs: Record<string, unknown> = {}
  for (const field of process.inputs) {
    if (field.id === 'relations') {
      inputs.relations = relations
      continue
    }
    const value = values[field.id] ?? initialValue(field)
    if (value !== undefined && value !== null && value !== '') inputs[field.id] = value
  }
  const outputs: Record<string, object> = {}
  for (const id of process.outputIds) if (!OUTPUTS_NOT_REQUESTED.has(id)) outputs[id] = {}

  const body = { inputs, outputs }
  return { body, extent, tables: tables.length, bodyBytes: new TextEncoder().encode(JSON.stringify(body)).length }
}

export function initialValue(field: ProcessField): unknown {
  const def = fieldDefault(field)
  if (def !== undefined && def !== null) return def
  const e = fieldEnum(field)
  if (e && field.required) return e[0]
  if (fieldType(field) === 'boolean') return false
  return undefined
}

/** Champs que l'interface sait afficher (listes de choix et cases à cocher), hors `relations`. */
export function editableFields(process: ProcessDetails): ProcessField[] {
  return process.inputs.filter((f) => f.id !== 'relations' && (fieldEnum(f) || fieldType(f) === 'boolean'))
}

export function preferredFormat(options: unknown[]): unknown {
  for (const p of ['GPKG', 'GEOPACKAGE', 'ESRI SHAPEFILE', 'GEOJSON']) {
    const hit = options.find((o) => String(o).toUpperCase() === p)
    if (hit !== undefined) return hit
  }
  return options[0]
}
