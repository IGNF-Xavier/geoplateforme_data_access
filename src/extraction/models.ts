/**
 * Normalisation défensive des réponses de l'API d'extraction (OGC API – Processes,
 * https://data.geopf.fr/extraction/swagger-ui/index.html). Le schéma des entrées d'un
 * processus n'est pas typé dans l'OpenAPI : `inputs` peut être un dictionnaire
 * {id: schéma} ou une liste d'objets dont le `title` fait office d'identifiant.
 */
type Obj = Record<string, unknown>
const isObject = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v)

export const DEFAULT_OUTPUT_IDS = ['logs', 'summary', 'extractedData']
/** Outputs déclarés mais refusés s'ils sont demandés (`jobName` : HTTP 400 constaté). */
export const OUTPUTS_NOT_REQUESTED = new Set(['jobName'])
const TITLE_TO_INPUT_ID: Record<string, string> = { 'durée de rétention': 'lifetime' }

export interface ProcessField {
  id: string
  title: string
  description: string
  schema: Obj
  required: boolean
}

export interface ProcessSummary {
  id: string
  title: string
  description: string
}

export interface ProcessDetails extends ProcessSummary {
  inputs: ProcessField[]
  outputIds: string[]
  describedByUrl?: string
}

export interface StoredTable {
  name: string
  attributes: Record<string, string>
  geometryAttribute?: string
}

export interface StoredData {
  id: string
  name: string
  srs: string
  tables: StoredTable[]
}

export interface Job {
  jobId: string
  status: string
  message: string
  created?: string
  finished?: string
  processId: string
}

export function normalizeInputs(raw: unknown): ProcessField[] {
  const fields: ProcessField[] = []
  if (isObject(raw)) {
    for (const [id, value] of Object.entries(raw)) {
      const holder = isObject(value) ? value : {}
      fields.push({
        id,
        title: String(holder.title || id),
        description: String(holder.description || ''),
        schema: (isObject(holder.schema) ? holder.schema : holder) as Obj,
        required: ![0, null, undefined].includes(holder.minOccurs as number | null | undefined) || holder.minOccurs === undefined,
      })
    }
  } else if (Array.isArray(raw)) {
    for (let item of raw) {
      if (!isObject(item)) continue
      if (isObject(item.input) && Object.keys(item).length === 1) item = item.input
      let id = String(item.id || item.name || item.title || '')
      id = TITLE_TO_INPUT_ID[id.toLowerCase()] || id
      if (!id) continue
      fields.push({
        id,
        title: String(item.title || id),
        description: String(item.description || ''),
        schema: (isObject(item.schema) ? item.schema : item) as Obj,
        required: String(item.minOccurs ?? 1) !== '0',
      })
    }
  }
  return fields
}

export const fieldType = (f: ProcessField): string => String(f.schema.type ?? '')
export const fieldEnum = (f: ProcessField): unknown[] | undefined => (Array.isArray(f.schema.enum) ? f.schema.enum : undefined)
export const fieldDefault = (f: ProcessField): unknown => f.schema.default

function normalizeOutputIds(raw: unknown): string[] {
  if (isObject(raw)) return Object.keys(raw)
  if (Array.isArray(raw)) return raw.filter(isObject).map((o) => String(o.id || o.name || '')).filter(Boolean)
  return []
}

export function parseProcessSummary(data: Obj): ProcessSummary {
  return { id: String(data.id ?? ''), title: String(data.title || data.id || ''), description: String(data.description || '') }
}

export function parseProcessDetails(data: Obj): ProcessDetails {
  const outputIds = normalizeOutputIds(data.outputs)
  const link = Array.isArray(data.links)
    ? (data.links as Obj[]).find((l) => isObject(l) && l.rel === 'describedby' && l.href)
    : undefined
  return {
    ...parseProcessSummary(data),
    inputs: normalizeInputs(data.inputs),
    outputIds: outputIds.length ? outputIds : [...DEFAULT_OUTPUT_IDS],
    describedByUrl: link ? String(link.href) : undefined,
  }
}

export function parseStoredData(data: Obj): StoredData {
  const typeInfos = isObject(data.type_infos) ? data.type_infos : {}
  const relations = Array.isArray(typeInfos.relations) ? (typeInfos.relations as Obj[]) : []
  const tables = relations
    .filter((r) => isObject(r) && r.name)
    .map<StoredTable>((r) => {
      const attributes = (isObject(r.attributes) ? r.attributes : {}) as Record<string, string>
      const geometryAttribute = Object.entries(attributes).find(([, t]) => typeof t === 'string' && t.startsWith('geometry'))?.[0]
      return { name: String(r.name), attributes, geometryAttribute }
    })
  return { id: String(data._id ?? ''), name: String(data.name || ''), srs: String(data.srs || ''), tables }
}

export function parseJob(data: Obj): Job {
  return {
    jobId: String(data.jobID ?? ''),
    status: String(data.status ?? ''),
    message: String(data.message || ''),
    created: data.created as string | undefined,
    finished: data.finished as string | undefined,
    processId: String(data.processID || ''),
  }
}

const RUNNING = ['RUNNING', 'ACCEPTED', 'WAITING', 'PROGRESS']
export const isRunning = (s: string) => RUNNING.includes(s.toUpperCase())
export const isSuccessful = (s: string) => s.toUpperCase() === 'SUCCESSFUL'
export const isFailed = (s: string) => ['FAILED', 'DISMISSED'].includes(s.toUpperCase())

export interface AtomFile {
  href: string
  mimeType: string
  filename: string
  isMetadata: boolean
}

/** Flux Atom (INSPIRE Download Service) du lien `extractData` : fichiers téléchargeables. */
export function parseAtomEntries(xml: string): AtomFile[] {
  const files: AtomFile[] = []
  for (const block of xml.match(/<entry[\s>][\s\S]*?<\/entry>/g) ?? []) {
    const link = block.match(/<link\b[^>]*>/)
    const href = link?.[0].match(/\bhref="([^"]*)"/)?.[1]
    if (!link || !href) continue
    const mime =
      block.match(/<(?:\w+:)?mime_type>([^<]*)<\/(?:\w+:)?mime_type>/)?.[1] ?? link[0].match(/\btype="([^"]*)"/)?.[1] ?? ''
    const url = href.replace(/&amp;/g, '&')
    const filename = decodeURIComponent(url.split('?')[0].split('/').filter(Boolean).pop() ?? 'fichier')
    files.push({ href: url, mimeType: mime, filename, isMetadata: mime === 'application/json' || filename.toLowerCase().endsWith('.json') })
  }
  return files
}
