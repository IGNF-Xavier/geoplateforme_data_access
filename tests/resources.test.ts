import { describe, expect, it } from 'vitest'
import {
  collectEditionDates, pickDefaultFormat, planZones, resolveDownload, selectEditions, zoneForDepartement, type DownloadApi,
} from '../src/services/resources'
import type { DatasetEdition } from '../src/types'
import { DEP_75, DEP_93, DEP_94, REG_11 } from './fixtures'

const ed = (zone: string, date: string, format = 'GPKG'): DatasetEdition => ({
  entryId: `E_${zone}_${format}_${date}`, title: `E_${zone}_${date}`, date, zone, format, url: `u/${zone}/${date}`,
})

/** Faux service de téléchargement (mock de test) : D094 daté 2026-09-15, D075 2026-06-15, D093 absent. */
function fakeApi(over: Partial<{ zones: string[]; formats: string[]; editions: DatasetEdition[]; sizes: Record<string, number | undefined> }> = {}): DownloadApi {
  const editions = over.editions ?? [ed('D094', '2026-06-15'), ed('D094', '2026-09-15'), ed('D075', '2026-06-15'), ed('D094', '2026-09-15', 'SHP')]
  return {
    getResourceInfo: async () => ({
      zones: over.zones ?? ['D094', 'D075', 'FXX'],
      formats: (over.formats ?? ['SHP', 'GPKG']).map((code) => ({ code, label: code })),
      crs: ['EPSG:2154'],
    }),
    listEditions: async (_id, f) => editions.filter((e) => e.zone === f.zone && (!f.format || e.format === f.format)),
    getEditionFiles: async (_id, entryId) => [{ url: `https://dl/${entryId}.7z`, fileName: `${entryId}.7z`, sizeBytes: over.sizes ? over.sizes[entryId] : 1000 }],
  }
}

describe('format par défaut', () => {
  it('préfère GPKG puis SHP, sinon le premier annoncé', () => {
    expect(pickDefaultFormat([{ code: 'SHP' }, { code: 'GPKG' }])).toBe('GPKG')
    expect(pickDefaultFormat([{ code: 'XYZ' }, { code: 'SHP' }])).toBe('SHP')
    expect(pickDefaultFormat([{ code: 'FlatGeoBuf' }])).toBe('FlatGeoBuf')
    expect(pickDefaultFormat([])).toBeUndefined()
  })
})

describe('zone → zones de téléchargement', () => {
  it('privilégie le département, puis la région, puis FXX, puis FRA', () => {
    expect(zoneForDepartement(DEP_94, new Set(['D094', 'R11', 'FXX']))).toBe('D094')
    expect(zoneForDepartement(DEP_94, new Set(['R11', 'FXX']))).toBe('R11')
    expect(zoneForDepartement(DEP_94, new Set(['FXX', 'FRA']))).toBe('FXX')
    expect(zoneForDepartement(DEP_94, new Set(['FRA']))).toBe('FRA')
    expect(zoneForDepartement(DEP_94, new Set(['D001']))).toBeUndefined()
  })

  it('n’utilise pas FXX pour l’outre-mer', () => {
    const guadeloupe = { code: 'D971', name: 'Guadeloupe', level: 'departement' as const }
    expect(zoneForDepartement(guadeloupe, new Set(['FXX']))).toBeUndefined()
    expect(zoneForDepartement(guadeloupe, new Set(['FXX', 'FRA']))).toBe('FRA')
  })

  it('fusionne les départements d’une même région et signale ceux sans couverture', () => {
    const plan = planZones([DEP_94, DEP_75, DEP_93, REG_11], ['R11'])
    expect(plan.zones).toEqual([{ code: 'R11', label: 'Île-de-France' }])
    expect(plan.uncovered).toEqual([])
    const plan2 = planZones([DEP_94, DEP_93], ['D094'])
    expect(plan2.zones.map((z) => z.code)).toEqual(['D094'])
    expect(plan2.uncovered.map((z) => z.code)).toEqual(['D093'])
  })
})

describe('choix de l’édition', () => {
  it('prend la dernière par défaut, ou la date exacte demandée', () => {
    const list = [ed('D094', '2025-03-15'), ed('D094', '2026-09-15'), ed('D094', '2026-06-15')]
    expect(selectEditions(list).map((e) => e.date)).toEqual(['2026-09-15'])
    expect(selectEditions(list, '2025-03-15')).toHaveLength(1)
    expect(selectEditions(list, '1999-01-01')).toEqual([])
  })

  it('traite les éditions sans date', () => {
    expect(selectEditions([{ ...ed('D094', 'x'), date: undefined }])).toHaveLength(1)
  })

  it('liste les dates proposées, la plus récente en premier', () => {
    expect(collectEditionDates([[ed('D094', '2026-06-15')], [ed('D075', '2026-09-15'), ed('D075', '2026-06-15')]])).toEqual(['2026-09-15', '2026-06-15'])
  })
})

describe('resolveDownload (emprise → ressources → paramètres de téléchargement)', () => {
  it('une zone dans un département : un fichier, dernière version, volume connu', async () => {
    const r = await resolveDownload(fakeApi(), 'BDTOPO', [DEP_94])
    expect(r.format).toBe('GPKG')
    expect(r.files).toHaveLength(1)
    expect(r.files[0].url).toContain('D094_GPKG_2026-09-15')
    expect(r.edition).toBe('2026-09-15')
    expect(r.totalBytes).toBe(1000)
    expect(r.uncovered).toEqual([])
    expect(r.availableDates).toEqual(['2026-09-15', '2026-06-15'])
    expect(r.availableFormats.map((f) => f.code)).toEqual(['SHP', 'GPKG'])
  })

  it('emprise à cheval sur deux départements : deux fichiers, volumes additionnés', async () => {
    const r = await resolveDownload(fakeApi(), 'BDTOPO', [DEP_94, DEP_75])
    expect(r.files.map((f) => f.zone).sort()).toEqual(['D075', 'D094'])
    expect(r.totalBytes).toBe(2000)
    expect(r.edition).toBe('2026-09-15')
  })

  it('partie de la zone hors couverture : résultat partiel', async () => {
    const r = await resolveDownload(fakeApi(), 'BDTOPO', [DEP_94, DEP_93], { })
    // D093 absent de la ressource mais FXX est annoncé sans éditions dans ce faux service
    expect(r.files).toHaveLength(1)
    expect(r.uncovered.map((z) => z.code)).toContain('FXX')
  })

  it('aucune zone couverte : aucun fichier', async () => {
    const r = await resolveDownload(fakeApi({ zones: ['D001'] }), 'BDTOPO', [DEP_94])
    expect(r.files).toEqual([])
    expect(r.uncovered.map((z) => z.code)).toEqual(['D094'])
  })

  it('format et version explicites (options avancées)', async () => {
    const r = await resolveDownload(fakeApi(), 'BDTOPO', [DEP_94], { format: 'GPKG', date: '2026-06-15' })
    expect(r.files[0].url).toContain('2026-06-15')
    const shp = await resolveDownload(fakeApi(), 'BDTOPO', [DEP_94], { format: 'SHP' })
    expect(shp.files[0].url).toContain('SHP')
  })

  it('version demandée absente pour une zone : la zone est signalée non couverte', async () => {
    const r = await resolveDownload(fakeApi(), 'BDTOPO', [DEP_94, DEP_75], { date: '2026-09-15' })
    expect(r.files).toHaveLength(1)
    expect(r.uncovered.map((z) => z.code)).toEqual(['D075'])
  })

  it('volume inconnu si une seule taille manque (jamais d’estimation)', async () => {
    const api = fakeApi({ sizes: { 'E_D094_GPKG_2026-09-15': 5000, 'E_D075_GPKG_2026-06-15': undefined } })
    const r = await resolveDownload(api, 'BDTOPO', [DEP_94, DEP_75])
    expect(r.files).toHaveLength(2)
    expect(r.totalBytes).toBeUndefined()
  })

  it('erreur API propagée', async () => {
    const api = { ...fakeApi(), listEditions: async () => { throw new Error('boom') } }
    await expect(resolveDownload(api, 'BDTOPO', [DEP_94])).rejects.toThrow('boom')
  })

  it('ressource sans format annoncé', async () => {
    await expect(resolveDownload(fakeApi({ formats: [] }), 'X', [DEP_94])).rejects.toThrow(/format/)
  })
})
