import { stripQuery } from '../../../api/catalogue'
import { validateServiceUrl } from '../../capabilities'
import type { GisAction, GisClientAdapter } from '../../types'

/**
 * Adaptateur générique « autre logiciel compatible » : fournit l'URL standard OGC
 * du service (GetCapabilities) et le nom de couche, utilisables par tout client
 * SIG implémentant WMS/WMTS/WFS (ArcGIS, MapInfo, gvSIG, GeoServer, Leaflet…).
 */
export const genericAdapter: GisClientAdapter = {
  id: 'generic',
  label: 'Autre logiciel compatible',
  instructions: [
    'Dans votre logiciel, ajoutez un service WMS, WMTS, WFS ou TMS (selon le protocole indiqué) avec cette URL.',
    'Sélectionnez ensuite la couche portant le nom indiqué.',
  ],
  actions(input) {
    const layerName = input.selectedLayer
    const services = input.availableServices.filter((s) => s.layer === layerName)
    return services.flatMap<GisAction>((s) => {
      // TMS : pas de GetCapabilities, mais un `metadata.json` par jeu de tuiles (vérifié sur data.geopf.fr/tms/1.0.0).
      const url = s.kind === 'TMS' ? `${stripQuery(s.endpoint).replace(/\/$/, '')}/${s.layer}/metadata.json` : (s.capabilitiesUrl ?? stripQuery(s.endpoint))
      try {
        validateServiceUrl(url)
      } catch {
        return []
      }
      return [
        {
          id: `generic-${s.kind}`,
          label: `Copier l’URL du service (${s.kind})`,
          description: `Couche « ${s.layer} »`,
          protocol: s.kind,
          run: async () => ({ kind: 'text', text: url }),
        },
      ]
    })
  },
}
