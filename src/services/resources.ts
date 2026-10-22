/**
 * Zone → ressources à obtenir.
 *
 * Méthode (documentée dans le README) :
 *  1. La zone de l'utilisateur est intersectée avec les limites ADMIN EXPRESS
 *     (WFS Géoplateforme) → départements et régions touchés.
 *  2. L'API de téléchargement décrit chaque ressource par une liste de « zones »
 *     (`D094`, `R11`, `FXX`, `FRA`…). Pour chaque département touché on retient,
 *     par ordre de finesse : la zone départementale, la zone régionale du
 *     département, `FXX` (métropole), `FRA` (France entière).
 *  3. Pour chaque zone retenue on liste les éditions dans le format choisi, puis on
 *     garde la plus récente (ou la date demandée).
 *  4. La taille de chaque fichier est lue dans le détail de l'édition (`length`) ;
 *     le volume total n'est affiché que si TOUTES les tailles sont connues.
 *
 * Limite assumée : les fichiers sont des découpages administratifs complets ;
 * l'API de téléchargement ne propose pas de découpe à l'emprise (le service
 * d'extraction qui le permet exige une authentification).
 */
import type { AdminZone, DatasetEdition, DownloadFile, ResolvedDownload } from '../types'

export interface DownloadApi {
  getResourceInfo(resourceId: string): Promise<{
    zones: string[]
    formats: { code: string; label: string }[]
    crs: string[]
    editionDateStart?: string
    editionDateEnd?: string
  }>
  listEditions(resourceId: string, filter: { zone?: string; format?: string }): Promise<DatasetEdition[]>
  getEditionFiles(resourceId: string, entryId: string): Promise<DownloadFile[]>
}

/** Ordre de préférence quand l'utilisateur n'a pas choisi de format. */
export const FORMAT_PREFERENCE = ['GPKG', 'GeoParquet', 'SHP', 'JP2', 'GEOTIFF', 'TIFF', 'COG']

export function pickDefaultFormat(formats: { code: string }[]): string | undefined {
  const codes = formats.map((f) => f.code)
  for (const preferred of FORMAT_PREFERENCE) {
    const hit = codes.find((c) => c.toUpperCase() === preferred)
    if (hit) return hit
  }
  return codes[0]
}

const isOverseas = (zoneCode: string) => /^D9[78]\d$/.test(zoneCode)

/** Zone de l'API de téléchargement à utiliser pour un département, ou `undefined`. */
export function zoneForDepartement(dep: AdminZone, available: ReadonlySet<string>): string | undefined {
  if (available.has(dep.code)) return dep.code
  if (dep.parentRegion && available.has(dep.parentRegion)) return dep.parentRegion
  if (!isOverseas(dep.code) && available.has('FXX')) return 'FXX'
  if (available.has('FRA')) return 'FRA'
  return undefined
}

export interface ZonePlan {
  zones: { code: string; label: string }[]
  uncovered: AdminZone[]
}

export function planZones(adminZones: AdminZone[], availableZones: string[]): ZonePlan {
  const available = new Set(availableZones)
  const zones = new Map<string, string>()
  const uncovered: AdminZone[] = []
  const regionName = new Map(adminZones.filter((z) => z.level === 'region').map((z) => [z.code, z.name]))

  for (const dep of adminZones.filter((z) => z.level === 'departement')) {
    const code = zoneForDepartement(dep, available)
    if (!code) {
      uncovered.push(dep)
      continue
    }
    if (!zones.has(code)) {
      zones.set(code, code === dep.code ? dep.name : (regionName.get(code) ?? labelForSpecialZone(code)))
    }
  }
  return { zones: [...zones].map(([code, label]) => ({ code, label })), uncovered }
}

function labelForSpecialZone(code: string): string {
  if (code === 'FXX') return 'France métropolitaine'
  if (code === 'FRA') return 'France entière'
  return code
}

/** Édition retenue pour une liste : date exacte demandée, sinon la plus récente. */
export function selectEditions(editions: DatasetEdition[], date?: string): DatasetEdition[] {
  const dated = editions.filter((e) => e.date)
  if (date) return editions.filter((e) => e.date === date)
  if (dated.length === 0) return editions
  const latest = dated.reduce((max, e) => (e.date! > max ? e.date! : max), dated[0].date!)
  return editions.filter((e) => e.date === latest)
}

/** Toutes les dates d'édition proposées pour les zones retenues, la plus récente d'abord. */
export function collectEditionDates(editionsByZone: DatasetEdition[][]): string[] {
  const dates = new Set<string>()
  editionsByZone.flat().forEach((e) => e.date && dates.add(e.date))
  return [...dates].sort().reverse()
}

export interface ResolveOptions {
  format?: string
  /** Date d'édition (ISO). Absente = dernière disponible pour chaque zone. */
  date?: string
}

export interface ResolveResult extends ResolvedDownload {
  availableFormats: { code: string; label: string }[]
  availableDates: string[]
  crs: string[]
}

export async function resolveDownload(
  api: DownloadApi,
  resourceId: string,
  adminZones: AdminZone[],
  options: ResolveOptions = {},
): Promise<ResolveResult> {
  const info = await api.getResourceInfo(resourceId)
  const format = options.format ?? pickDefaultFormat(info.formats)
  if (!format) throw new Error('Aucun format de téléchargement n’est annoncé pour cette ressource.')

  const plan = planZones(adminZones, info.zones)
  const perZone = await Promise.all(
    plan.zones.map(async (z) => ({ zone: z, editions: await api.listEditions(resourceId, { zone: z.code, format }) })),
  )

  const uncovered = [...plan.uncovered]
  const picked: { zoneCode: string; zoneLabel: string; edition: DatasetEdition }[] = []
  for (const { zone, editions } of perZone) {
    const chosen = selectEditions(editions, options.date)
    if (chosen.length === 0) {
      uncovered.push({ code: zone.code, name: zone.label, level: zone.code.startsWith('R') ? 'region' : 'departement' })
      continue
    }
    chosen.forEach((edition) => picked.push({ zoneCode: zone.code, zoneLabel: zone.label, edition }))
  }

  const files = (
    await Promise.all(
      picked.map(async (p) => {
        const entryFiles = await api.getEditionFiles(resourceId, p.edition.entryId)
        return entryFiles.map((f) => ({ ...f, zone: p.zoneCode, zoneLabel: p.zoneLabel }))
      }),
    )
  ).flat()

  const allSized = files.length > 0 && files.every((f) => typeof f.sizeBytes === 'number')
  const dates = picked.map((p) => p.edition.date).filter((d): d is string => !!d)

  return {
    edition: dates.length ? [...dates].sort().reverse()[0] : undefined,
    format,
    files,
    totalBytes: allSized ? files.reduce((n, f) => n + (f.sizeBytes ?? 0), 0) : undefined,
    uncovered,
    availableFormats: info.formats,
    availableDates: collectEditionDates(perZone.map((p) => p.editions)),
    crs: info.crs,
  }
}
