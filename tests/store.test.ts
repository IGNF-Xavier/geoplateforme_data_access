import { describe, expect, it, vi } from 'vitest'
import { Store } from '../src/state/store'
import { parseRecord } from '../src/api/catalogue'
import { createArea, bboxToPolygon } from '../src/utils/geo'
import { BDTOPO_RECORD } from './fixtures'

describe('Store (états de l’application)', () => {
  it('part de l’état IDLE sans donnée ni zone', () => {
    const s = new Store().get()
    expect(s.search.status).toBe('idle')
    expect(s.download.status).toBe('idle')
    expect(s.dataset).toBeUndefined()
    expect(s.area).toBeUndefined()
  })

  it('sélection de donnée, d’emprise, changement puis suppression', () => {
    const store = new Store()
    const listener = vi.fn()
    store.subscribe(listener)

    const dataset = parseRecord(BDTOPO_RECORD)
    store.set({ dataset })
    expect(store.get().dataset?.id).toBe('IGNF_BD-TOPO')

    const a1 = createArea(bboxToPolygon([2.41, 48.83, 2.46, 48.86]), 'rectangle', 'Rectangle')
    store.set({ area: a1 })
    expect(store.get().area?.bbox).toEqual([2.41, 48.83, 2.46, 48.86])

    const a2 = createArea(bboxToPolygon([5, 43, 5.5, 43.5]), 'viewport', 'Carte')
    store.set({ area: a2 })
    expect(store.get().area?.label).toBe('Carte')

    store.set({ area: undefined, download: { status: 'idle' } })
    expect(store.get().area).toBeUndefined()
    expect(store.get().dataset).toBeDefined()
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('modélise les états LOADING / READY / EMPTY / PARTIAL / ERROR', () => {
    const store = new Store()
    for (const status of ['loading', 'ready', 'empty', 'partial', 'error'] as const) {
      store.set({ download: { status } })
      expect(store.get().download.status).toBe(status)
    }
  })

  it('se désabonne', () => {
    const store = new Store()
    const l = vi.fn()
    const off = store.subscribe(l)
    off()
    store.set({ query: 'x' })
    expect(l).not.toHaveBeenCalled()
  })
})
