/**
 * Façade unique vers les APIs Géoplateforme : l'UI et la carte ne font jamais de
 * fetch() directement.
 */
import { getDatasetById } from '../api/catalogue'
import { getEditionFiles, getResourceInfo, listEditions } from '../api/download'
import type { RequestOptions } from '../api/http'
import { getAdminZonesIntersecting, getCommuneGeometry, searchPlaces } from '../api/places'
import type { AdminZone, Area, Dataset, DownloadResourceRef, Place } from '../types'
import { createArea, type Geometry } from '../utils/geo'
import { searchAll } from './search'
import { resolveDownload, type DownloadApi, type ResolveOptions, type ResolveResult } from './resources'

export class GeoPlatformService {
  constructor(
    private readonly download: DownloadApi = {
      getResourceInfo: (id) => getResourceInfo(id),
      listEditions: (id, filter) => listEditions(id, filter),
      getEditionFiles: (id, entry) => getEditionFiles(id, entry),
    },
  ) {}

  /** Catalogue GeoNetwork + index de recherche Géoplateforme, fusionnés. */
  searchDatasets(query: string, options?: Parameters<typeof searchAll>[1]) {
    return searchAll(query, options)
  }

  getDataset(id: string, options?: RequestOptions): Promise<Dataset | undefined> {
    return getDatasetById(id, options)
  }

  searchPlaces(query: string, options?: RequestOptions): Promise<Place[]> {
    return searchPlaces(query, options)
  }

  /** Transforme un lieu en zone : contour communal si disponible, sinon aucune zone. */
  async placeToArea(place: Place, options?: RequestOptions): Promise<Area | undefined> {
    if (!place.citycode) return undefined
    const geometry = await getCommuneGeometry(place.citycode, options)
    return geometry ? createArea(geometry, 'place', place.label) : undefined
  }

  getAdminZones(geometry: Geometry, options?: RequestOptions): Promise<AdminZone[]> {
    return getAdminZonesIntersecting(geometry, options)
  }

  /** Ressources de téléchargement correspondant à une zone pour une ressource donnée. */
  getDownloadResources(
    resource: DownloadResourceRef,
    adminZones: AdminZone[],
    options?: ResolveOptions,
  ): Promise<ResolveResult> {
    return resolveDownload(this.download, resource.id, adminZones, options)
  }
}

export const geoPlatform = new GeoPlatformService()
