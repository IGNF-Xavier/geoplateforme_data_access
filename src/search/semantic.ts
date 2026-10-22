/**
 * Recherche sémantique locale : la saisie est transformée en vecteur par un petit modèle
 * multilingue exécuté DANS le navigateur (transformers.js + ONNX/WASM, aucune requête vers
 * un service externe), puis comparée à un index de vecteurs pré-calculé (public/semantic/index.json,
 * généré par scripts/build-semantic-index.mjs avec le même modèle).
 *
 * Elle rapproche des formulations très différentes (« photos prises d'avion » ↔ orthophotographies)
 * sans passer par le thésaurus. Elle ne remplace pas la recherche lexicale : les deux se complètent
 * (cf. services/search.ts).
 */

export const SEMANTIC_MODEL = 'Xenova/multilingual-e5-small'
/** Poids approximatif à télécharger une fois (modèle quantifié + tokenizer), mis en cache par le navigateur. */
export const SEMANTIC_DOWNLOAD_MB = 135

export interface SemanticIndex {
  model: string
  dim: number
  scale: number
  createdAt?: string
  items: { id: string; src: 'c' | 'i'; title: string }[]
  /** Vecteurs normalisés, quantifiés sur 8 bits signés, concaténés, en base64. */
  vectors: string
}

export interface SemanticHit {
  id: string
  /** `c` : fiche du catalogue (id = uuid) ; `i` : couche de l'index (id = nom de couche). */
  src: 'c' | 'i'
  title: string
  /** Similarité cosinus (−1 à 1). */
  sim: number
}

export type SemanticStatus = 'off' | 'loading' | 'ready' | 'error'

export interface SemanticProgress {
  /** 0–100, approximatif (téléchargement du modèle). */
  percent: number
  label: string
}

export function decodeVectors(b64: string): Int8Array {
  const bin = atob(b64)
  const out = new Int8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = (bin.charCodeAt(i) << 24) >> 24
  return out
}

/** Les `k` éléments les plus proches (produit scalaire = cosinus pour des vecteurs normalisés). */
export function topK(query: ArrayLike<number>, index: SemanticIndex, vectors: Int8Array, k: number): SemanticHit[] {
  const { dim, scale, items } = index
  if (query.length !== dim) throw new Error(`Dimension inattendue : ${query.length} au lieu de ${dim}.`)
  const scored: SemanticHit[] = []
  for (let n = 0; n < items.length; n++) {
    let dot = 0
    const base = n * dim
    for (let d = 0; d < dim; d++) dot += query[d] * vectors[base + d]
    scored.push({ ...items[n], sim: dot / scale })
  }
  return scored.sort((a, b) => b.sim - a.sim).slice(0, k)
}

export type Embedder = (text: string) => Promise<Float32Array>

export interface SemanticOptions {
  /** Fournit l'index (par défaut : fetch du fichier statique). */
  loadIndex?: () => Promise<SemanticIndex>
  /** Fournit le vectoriseur (par défaut : transformers.js dans le navigateur). */
  createEmbedder?: (onProgress: (p: SemanticProgress) => void) => Promise<Embedder>
}

async function defaultLoadIndex(): Promise<SemanticIndex> {
  const response = await fetch(`${import.meta.env.BASE_URL}semantic/index.json`)
  if (!response.ok) throw new Error(`Index sémantique introuvable (HTTP ${response.status}).`)
  return (await response.json()) as SemanticIndex
}

async function defaultCreateEmbedder(onProgress: (p: SemanticProgress) => void): Promise<Embedder> {
  // Import dynamique : ~800 Ko de JS + le moteur WASM ne sont chargés que si la fonction est activée.
  const { pipeline, env } = await import('@huggingface/transformers')
  env.allowLocalModels = false
  const files = new Map<string, number>()
  const extractor = await pipeline('feature-extraction', SEMANTIC_MODEL, {
    dtype: 'q8',
    progress_callback: (e: { status: string; file?: string; progress?: number }) => {
      if (e.status === 'progress' && e.file && typeof e.progress === 'number') {
        files.set(e.file, e.progress)
        const total = [...files.values()].reduce((a, b) => a + b, 0) / Math.max(files.size, 3)
        onProgress({ percent: Math.min(99, Math.round(total)), label: 'Téléchargement du modèle' })
      }
    },
  })
  return async (text) => {
    const out = await extractor(text, { pooling: 'mean', normalize: true })
    return Float32Array.from(out.data as Float32Array)
  }
}

export class SemanticSearch {
  status: SemanticStatus = 'off'
  progress: SemanticProgress = { percent: 0, label: '' }
  error?: string
  private index?: SemanticIndex
  private vectors?: Int8Array
  private embed?: Embedder
  private starting?: Promise<void>
  private listeners = new Set<() => void>()

  constructor(private readonly options: SemanticOptions = {}) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(patch: Partial<Pick<SemanticSearch, 'status' | 'progress' | 'error'>>): void {
    Object.assign(this, patch)
    this.listeners.forEach((l) => l())
  }

  /** Charge l'index et le modèle (une seule fois). N'échoue jamais : l'état passe à `error`. */
  enable(): Promise<void> {
    if (!this.starting) {
      this.starting = (async () => {
        this.set({ status: 'loading', progress: { percent: 0, label: 'Préparation' }, error: undefined })
        try {
          const [index, embed] = await Promise.all([
            (this.options.loadIndex ?? defaultLoadIndex)(),
            (this.options.createEmbedder ?? defaultCreateEmbedder)((progress) => this.set({ progress })),
          ])
          this.index = index
          this.vectors = decodeVectors(index.vectors)
          this.embed = embed
          this.set({ status: 'ready', progress: { percent: 100, label: 'Prête' } })
        } catch (error) {
          this.starting = undefined
          this.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      })()
    }
    return this.starting
  }

  get ready(): boolean {
    return this.status === 'ready'
  }

  async search(text: string, k = 12): Promise<SemanticHit[]> {
    if (!this.ready || !this.index || !this.vectors || !this.embed || !text.trim()) return []
    return topK(await this.embed(`query: ${text.trim()}`), this.index, this.vectors, k)
  }
}
