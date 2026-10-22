import { describeWmtsLayer } from '../../../api/wmts'
import type { ServiceAccess } from '../../../types'
import { groupByLayer } from '../../capabilities'
import { buildQlr, qgisSource, qlrFileName, type QgisSource } from '../../export/qgis'
import type { GisAction, GisClientAdapter, GisInput } from '../../types'

/**
 * Adaptateur QGIS — uniquement des mécanismes natifs :
 *  - fichier de définition de couche .qlr (glisser-déposer / menu Couche) ;
 *  - source de données copiable pour Gestionnaire de sources de données.
 * QGIS ne documente aucun schéma d'URL (qgis://…) permettant à un navigateur de
 * le lancer ; l'ouverture automatique n'est donc pas proposée (cf. README).
 */

function chosenAccess(input: GisInput): ServiceAccess | undefined {
  const layers = groupByLayer(input.availableServices)
  const layer = layers.find((l) => l.layer === input.selectedLayer)
  // Seuls WMTS, WMS et WFS sont chargés par les fichiers générés ; le TMS reste réservé à l’adaptateur générique.
  return (['WMTS', 'WMS', 'WFS'] as const).map((k) => layer?.services.find((s) => s.kind === k)).find(Boolean)
}

async function toSource(access: ServiceAccess, title: string, signal?: AbortSignal): Promise<QgisSource> {
  const wmts =
    access.kind === 'WMTS' && access.capabilitiesUrl
      ? await describeWmtsLayer(access.capabilitiesUrl, access.layer, signal)
      : undefined
  if (access.kind === 'WMTS' && !wmts) {
    throw new Error(`La couche WMTS « ${access.layer} » est introuvable dans les capacités du service.`)
  }
  return qgisSource(access, title, wmts)
}

export const qgisAdapter: GisClientAdapter = {
  id: 'qgis',
  label: 'QGIS',
  instructions: [
    'Ouvrez le fichier téléchargé : double-clic (s’il est associé à QGIS) ou glissez-le sur la carte de QGIS.',
    'Ou : Couche › Ajouter une couche › Ajouter depuis un fichier de définition de couche, puis choisissez le fichier .qlr.',
  ],
  actions(input) {
    const access = chosenAccess(input)
    if (!access) return []
    const title = input.selectedLayer && input.selectedLayer !== input.resource.title
      ? `${input.resource.title} — ${input.selectedLayer}`
      : input.resource.title

    const qlr: GisAction = {
      id: 'qgis-qlr',
      label: 'Télécharger le fichier QGIS (.qlr)',
      description: 'Fichier de couche natif QGIS, sans plugin.',
      protocol: access.kind,
      async run(signal) {
        const source = await toSource(access, title, signal)
        return { kind: 'file', fileName: qlrFileName(title), mimeType: 'application/xml', content: buildQlr([source]) }
      },
    }
    const uri: GisAction = {
      id: 'qgis-uri',
      label: 'Copier la connexion QGIS',
      description: 'Source de données à coller dans le Gestionnaire de sources de données (Ctrl+L).',
      protocol: access.kind,
      async run(signal) {
        const source = await toSource(access, title, signal)
        return { kind: 'text', text: source.uri }
      },
    }
    return [qlr, uri]
  },
}
