export type ApiErrorKind = 'timeout' | 'network' | 'http' | 'parse' | 'aborted'

export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    message: string,
    public readonly status?: number,
    public readonly url?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const DEFAULT_TIMEOUT_MS = 15000

export interface RequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
  init?: RequestInit
}

/**
 * fetch + JSON avec timeout et annulation. L'annulation par l'appelant
 * (`signal`) est distinguée du timeout : la première lève `aborted`
 * (à ignorer côté UI), le second `timeout` (à afficher).
 */
export async function fetchJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { signal, timeoutMs = DEFAULT_TIMEOUT_MS, init } = options
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) {
      throw new ApiError('http', `Le service a répondu avec le code ${response.status}.`, response.status, url)
    }
    try {
      return (await response.json()) as T
    } catch {
      throw new ApiError('parse', 'La réponse du service est illisible.', response.status, url)
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (timedOut) throw new ApiError('timeout', 'Le service met trop de temps à répondre.', undefined, url)
    if (signal?.aborted || (error as Error).name === 'AbortError') {
      throw new ApiError('aborted', 'Requête annulée.', undefined, url)
    }
    throw new ApiError('network', 'Le service est injoignable (réseau indisponible ?).', undefined, url)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export function isAborted(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'aborted'
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.'
}
