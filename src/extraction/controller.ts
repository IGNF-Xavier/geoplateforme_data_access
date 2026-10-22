/**
 * Orchestration de l'extraction sur la zone : produits du compte → produit choisi →
 * tables → lancement → suivi du job → fichiers. Aucune simulation : sans jeton valide,
 * aucune de ces étapes ne démarre.
 */
import type { AuthState } from '../auth/auth'
import { JOB_POLL_INTERVAL_MS } from '../config'
import type { Store } from '../state/store'
import type { Dataset } from '../types'
import { ExtractionApi, ExtractionError, describeExtractionError } from './api'
import { buildExtractionPlan, editableFields, initialValue, matchProcesses, preferredFormat } from './builder'
import { fieldEnum, isFailed, isRunning, isSuccessful } from './models'

export class ExtractionController {
  private poll?: ReturnType<typeof setTimeout>
  private abort?: AbortController

  constructor(
    private readonly store: Store,
    private readonly auth: AuthState,
    private readonly api: ExtractionApi = new ExtractionApi({ getToken: () => auth.token }),
    private readonly pollMs = JOB_POLL_INTERVAL_MS,
  ) {}

  private signal(): AbortSignal {
    this.abort?.abort()
    this.abort = new AbortController()
    return this.abort.signal
  }

  private fail(error: unknown): void {
    this.store.patchExtraction({
      launching: false,
      error: { message: describeExtractionError(error), report: error instanceof ExtractionError ? error.report() : undefined },
    })
  }

  /** Charge la liste des produits du compte et présélectionne le plus proche de la donnée. */
  async loadProcesses(dataset: Dataset): Promise<void> {
    if (!this.auth.authenticated) return void this.store.patchExtraction({ processes: { status: 'idle' } })
    const signal = this.signal()
    this.store.patchExtraction({ processes: { status: 'loading' }, error: undefined })
    try {
      const matches = matchProcesses(dataset, await this.api.listProcesses(signal))
      if (!matches.length) {
        return void this.store.patchExtraction({ processes: { status: 'empty', message: 'Aucun produit d’extraction n’est disponible pour votre compte.' } })
      }
      this.store.patchExtraction({ processes: { status: 'ready', data: matches } })
      const best = matches[0]
      if (best.score >= 0.5) await this.chooseProcess(best.process.id)
    } catch (error) {
      if (signal.aborted) return
      this.store.patchExtraction({ processes: { status: 'error', message: describeExtractionError(error) } })
    }
  }

  async chooseProcess(id: string): Promise<void> {
    const signal = this.signal()
    this.store.patchExtraction({
      processId: id, details: { status: 'loading' }, selectedTables: [], values: {}, job: undefined, files: undefined, error: undefined, plan: undefined,
    })
    try {
      const process = await this.api.getProcess(id, signal)
      if (!process.describedByUrl) throw new Error('Le produit ne décrit pas ses tables (lien « describedby » absent).')
      const stored = await this.api.getStoredData(process.describedByUrl, signal)
      const values: Record<string, unknown> = {}
      for (const f of editableFields(process)) {
        const options = fieldEnum(f)
        values[f.id] = f.id === 'format' && options ? preferredFormat(options) : initialValue(f)
      }
      this.store.patchExtraction({
        details: { status: 'ready', data: { process, stored } },
        selectedTables: stored.tables.map((t) => t.name),
        values,
      })
    } catch (error) {
      if (signal.aborted) return
      this.store.patchExtraction({ details: { status: 'error', message: describeExtractionError(error) } })
    }
  }

  toggleTable(name: string): void {
    const { selectedTables } = this.store.get().extraction
    this.store.patchExtraction({
      selectedTables: selectedTables.includes(name) ? selectedTables.filter((t) => t !== name) : [...selectedTables, name],
    })
  }

  setAllTables(all: boolean): void {
    const stored = this.store.get().extraction.details.data?.stored
    this.store.patchExtraction({ selectedTables: all && stored ? stored.tables.map((t) => t.name) : [] })
  }

  setValue(id: string, value: unknown): void {
    this.store.patchExtraction({ values: { ...this.store.get().extraction.values, [id]: value } })
  }

  async launch(): Promise<void> {
    const state = this.store.get()
    const { area, extraction } = state
    const data = extraction.details.data
    if (!area || !data || !extraction.processId) return
    try {
      const tables = data.stored.tables.filter((t) => extraction.selectedTables.includes(t.name))
      const plan = buildExtractionPlan(data.process, data.stored, tables, area.geometry, extraction.values)
      this.store.patchExtraction({ launching: true, error: undefined, plan, files: undefined, logs: undefined })
      const job = await this.api.execute(extraction.processId, plan.body)
      this.store.patchExtraction({ launching: false, job })
      this.schedule(job.jobId, 2000)
    } catch (error) {
      this.fail(error)
    }
  }

  private schedule(jobId: string, delay = this.pollMs): void {
    clearTimeout(this.poll)
    this.poll = setTimeout(() => void this.refresh(jobId), delay)
  }

  /** Interroge le job ; se reprogramme tant qu'il tourne. */
  async refresh(jobId: string): Promise<void> {
    try {
      const job = await this.api.getJob(jobId)
      this.store.patchExtraction({ job })
      if (isRunning(job.status)) return this.schedule(jobId)
      if (isSuccessful(job.status)) {
        const results = await this.api.getJobResults(jobId)
        const files = results.extractDataHref ? await this.api.resolveDownloadFiles(results.extractDataHref) : []
        this.store.patchExtraction({ files, logs: results.logs })
      } else if (isFailed(job.status)) {
        const results = await this.api.getJobResults(jobId).catch(() => undefined)
        this.store.patchExtraction({ logs: results?.logs, error: { message: job.message || 'L’extraction a échoué.' } })
      }
    } catch (error) {
      this.fail(error)
    }
  }

  async cancel(): Promise<void> {
    const job = this.store.get().extraction.job
    clearTimeout(this.poll)
    if (!job) return
    try {
      await this.api.deleteJob(job.jobId)
      this.store.patchExtraction({ job: undefined, files: undefined })
    } catch (error) {
      this.fail(error)
    }
  }

  reset(): void {
    clearTimeout(this.poll)
    this.abort?.abort()
  }
}
