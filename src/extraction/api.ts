/**
 * Client de l'API d'extraction de la Géoplateforme (OGC API – Processes).
 * Endpoints : GET /processes, GET /processes/{id}, POST /processes/{id}/execution,
 * GET /jobs/{id}, GET /jobs/{id}/results, DELETE /jobs/{id}. Tous exigent un jeton Bearer.
 * Particularités constatées : un seul job simultané par compte (HTTP 429), les jobs
 * prennent plusieurs minutes, la requête est refusée au-delà de ≈ 256 Ko (HTTP 500).
 */
import { EXTRACTION_BASE } from '../config'
import {
  parseAtomEntries, parseJob, parseProcessDetails, parseProcessSummary, parseStoredData,
  type AtomFile, type Job, type ProcessDetails, type ProcessSummary, type StoredData,
} from './models'

type Obj = Record<string, unknown>

export class ExtractionError extends Error {
  constructor(
    public readonly method: string,
    public readonly url: string,
    public readonly status: number,
    public readonly body: string,
    public readonly requestBody?: unknown,
  ) {
    super(`${method} ${url} -> HTTP ${status}`)
    this.name = 'ExtractionError'
  }

  /** Requête envoyée + réponse reçue, à copier dans un ticket (jamais le jeton). */
  report(): string {
    const pretty = (t: string) => {
      try {
        return JSON.stringify(JSON.parse(t), null, 2)
      } catch {
        return t
      }
    }
    return [
      `### Requête\n${this.method} ${this.url}`,
      ...(this.requestBody !== undefined ? [JSON.stringify(this.requestBody, null, 2)] : []),
      `\n### Réponse\nHTTP ${this.status}`,
      ...(this.body ? [pretty(this.body)] : []),
    ].join('\n')
  }
}

export function describeExtractionError(error: unknown): string {
  if (!(error instanceof ExtractionError)) return error instanceof Error ? error.message : String(error)
  if (error.status === 401) return 'Jeton refusé ou expiré : reconnectez-vous.'
  if (error.status === 403) return 'Votre compte n’a pas les droits nécessaires pour ce produit.'
  if (error.status === 429) return 'Un seul job à la fois est autorisé par compte : attendez la fin du job en cours (ou annulez-le).'
  if (error.status === 0) return error.body
  if (error.status === 500) return 'Le service a refusé la requête (HTTP 500). Si la zone est très détaillée, essayez une zone plus simple ou moins de tables.'
  return `Le service a refusé la requête (HTTP ${error.status}).`
}

export interface ExtractionApiOptions {
  base?: string
  getToken?: () => string
  fetchImpl?: typeof fetch
}

export class ExtractionApi {
  private readonly base: string
  private readonly getToken: () => string
  private readonly fetchImpl: typeof fetch

  constructor({ base = EXTRACTION_BASE, getToken = () => '', fetchImpl = (...a) => fetch(...a) }: ExtractionApiOptions = {}) {
    this.base = base.replace(/\/$/, '')
    this.getToken = getToken
    this.fetchImpl = fetchImpl
  }

  private async request(
    method: string,
    url: string,
    { body, accept = 'application/json', auth = true, signal }: { body?: unknown; accept?: string; auth?: boolean; signal?: AbortSignal } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: accept }
    const token = this.getToken()
    if (auth && token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    let response: Response
    try {
      response = await this.fetchImpl(url, { method, headers, signal, body: body !== undefined ? JSON.stringify(body) : undefined })
    } catch (cause) {
      if (signal?.aborted) throw cause
      throw new ExtractionError(method, url, 0, `Requête impossible (réseau ou CORS) : ${(cause as Error).message}`, body)
    }
    if (!response.ok) throw new ExtractionError(method, url, response.status, await response.text(), body)
    return response
  }

  private async json<T = Obj>(method: string, url: string, options?: Parameters<ExtractionApi['request']>[2]): Promise<T> {
    return (await this.request(method, url, options)).json() as Promise<T>
  }

  async listProcesses(signal?: AbortSignal, limit = 200): Promise<ProcessSummary[]> {
    const data = await this.json<Obj | Obj[]>('GET', `${this.base}/processes?page=1&limit=${limit}`, { signal })
    const items = Array.isArray(data) ? data : (data.processes as Obj[] | undefined)
    if (!Array.isArray(items)) throw new ExtractionError('GET', `${this.base}/processes`, 200, 'Réponse inattendue')
    return items.map(parseProcessSummary)
  }

  async getProcess(id: string, signal?: AbortSignal): Promise<ProcessDetails> {
    return parseProcessDetails(await this.json('GET', `${this.base}/processes/${encodeURIComponent(id)}`, { signal }))
  }

  /** Description de la donnée stockée sous-jacente (liste des tables, projection native). */
  async getStoredData(url: string, signal?: AbortSignal): Promise<StoredData> {
    return parseStoredData(await this.json('GET', url, { signal }))
  }

  async execute(processId: string, body: unknown, signal?: AbortSignal): Promise<Job> {
    return parseJob(await this.json('POST', `${this.base}/processes/${encodeURIComponent(processId)}/execution`, { body, signal }))
  }

  async getJob(jobId: string, signal?: AbortSignal): Promise<Job> {
    return parseJob(await this.json('GET', `${this.base}/jobs/${encodeURIComponent(jobId)}`, { signal }))
  }

  async getJobResults(jobId: string, signal?: AbortSignal): Promise<{ logs: string; extractDataHref?: string }> {
    const data = await this.json<Obj>('GET', `${this.base}/jobs/${encodeURIComponent(jobId)}/results`, { signal })
    const extract = data.extractData as { href?: string } | undefined
    return { logs: String(data.logs || ''), extractDataHref: extract?.href }
  }

  async deleteJob(jobId: string): Promise<void> {
    await this.request('DELETE', `${this.base}/jobs/${encodeURIComponent(jobId)}`)
  }

  /** Le lien `extractData` renvoie un flux Atom listant les fichiers (sans authentification). */
  async resolveDownloadFiles(extractDataHref: string, signal?: AbortSignal): Promise<AtomFile[]> {
    const response = await this.request('GET', extractDataHref, { accept: 'application/atom+xml', auth: false, signal })
    return parseAtomEntries(await response.text())
  }
}
