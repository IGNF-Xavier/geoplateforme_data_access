/**
 * API de téléchargement de la Géoplateforme (flux Atom servi en JSON si
 * `Accept: application/json`).
 *
 * Endpoints réellement utilisés :
 *  - GET /telechargement/resource/{ressource}?zone=&format=&limit=&page=
 *      liste les éditions (`entry[]`) ; `limit` est le paramètre de taille de page
 *      (`pagesize` est ignoré) ; les éditions sont renvoyées par date croissante.
 *  - GET /telechargement/resource/{ressource}/{edition}
 *      détail d'une édition : `entry[].link[].length` = taille réelle en octets.
 *
 * Les ressources ne sont PAS décrites par des géométries (`polygon` est toujours
 * nul) : elles sont organisées par « zone » administrative (D094, R11, FXX, FRA…).
 */
import type { DatasetEdition, DownloadFile } from '../types'
import { fetchJson, type RequestOptions } from './http'

export const DOWNLOAD_BASE = 'https://data.geopf.fr/telechargement'

interface Term {
  term: string
  label?: string
}

interface AtomLink {
  href: string
  rel?: string
  type?: string
  length?: number
}

interface AtomEntry {
  id: string
  title?: string
  editionDate?: string
  updated?: string
  zone?: Term | Term[]
  format?: Term | Term[]
  link?: AtomLink[]
  mime_type?: string[]
}

export interface AtomFeed {
  page?: number
  pagecount?: number
  totalentries?: number
  title?: string
  zone?: Term[]
  format?: Term[]
  categories?: Term[]
  editionDateStart?: string
  editionDateEnd?: string
  entry?: AtomEntry[]
}

const one = <T>(v?: T | T[]): T | undefined => (Array.isArray(v) ? v[0] : v)

export interface ResourceInfo {
  title?: string
  zones: string[]
  formats: { code: string; label: string }[]
  crs: string[]
  editionDateStart?: string
  editionDateEnd?: string
}

export function parseResourceInfo(feed: AtomFeed): ResourceInfo {
  return {
    title: feed.title,
    zones: (feed.zone ?? []).map((z) => z.term),
    formats: (feed.format ?? []).map((f) => ({ code: f.term, label: f.label ?? f.term })),
    crs: (feed.categories ?? []).map((c) => c.label ?? c.term),
    editionDateStart: feed.editionDateStart,
    editionDateEnd: feed.editionDateEnd,
  }
}

export function parseEditions(feed: AtomFeed): DatasetEdition[] {
  return (feed.entry ?? []).flatMap((e) => {
    const zone = one(e.zone)?.term
    const format = one(e.format)?.term
    const url = e.link?.find((l) => l.rel === 'alternate')?.href ?? e.id
    if (!zone || !format || !e.id) return []
    return [
      {
        entryId: e.id.split('/').pop() ?? e.id,
        title: e.title ?? e.id,
        date: e.editionDate,
        zone,
        format,
        url,
      },
    ]
  })
}

export function parseEditionFiles(feed: AtomFeed): DownloadFile[] {
  return (feed.entry ?? []).flatMap((e) => {
    const link = e.link?.[0]
    if (!link?.href) return []
    return [
      {
        url: link.href,
        fileName: decodeURIComponent(link.href.split('/').pop() ?? link.href),
        sizeBytes: typeof link.length === 'number' ? link.length : undefined,
        mimeType: link.type,
      },
    ]
  })
}

const getFeed = (url: string, options: RequestOptions) =>
  fetchJson<AtomFeed>(url, { ...options, init: { headers: { Accept: 'application/json' } } })

export async function getResourceInfo(resourceId: string, options: RequestOptions = {}): Promise<ResourceInfo> {
  const feed = await getFeed(`${DOWNLOAD_BASE}/resource/${encodeURIComponent(resourceId)}?limit=1`, options)
  return parseResourceInfo(feed)
}

/** Liste toutes les éditions (toutes pages) d'une ressource pour une zone/format donnés. */
export async function listEditions(
  resourceId: string,
  filter: { zone?: string; format?: string },
  options: RequestOptions = {},
): Promise<DatasetEdition[]> {
  const editions: DatasetEdition[] = []
  let page = 1
  let pageCount = 1
  do {
    const params = new URLSearchParams({ limit: '100', page: String(page) })
    if (filter.zone) params.set('zone', filter.zone)
    if (filter.format) params.set('format', filter.format)
    const feed = await getFeed(`${DOWNLOAD_BASE}/resource/${encodeURIComponent(resourceId)}?${params}`, options)
    editions.push(...parseEditions(feed))
    pageCount = feed.pagecount ?? 1
    page += 1
  } while (page <= pageCount && page <= 20)
  return editions
}

export async function getEditionFiles(
  resourceId: string,
  entryId: string,
  options: RequestOptions = {},
): Promise<DownloadFile[]> {
  const feed = await getFeed(
    `${DOWNLOAD_BASE}/resource/${encodeURIComponent(resourceId)}/${encodeURIComponent(entryId)}`,
    options,
  )
  return parseEditionFiles(feed)
}
