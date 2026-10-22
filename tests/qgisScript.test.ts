import { describe, expect, it } from 'vitest'
import { QGIS_TOKEN_SCRIPT } from '../src/auth/qgisTokenScript'

describe('script d’obtention du jeton depuis QGIS', () => {
  it('lit l’en-tête d’authentification localement, sans émettre la requête', () => {
    expect(QGIS_TOKEN_SCRIPT).toContain('QgsApplication.authManager()')
    expect(QGIS_TOKEN_SCRIPT).toContain('updateNetworkRequest')
    expect(QGIS_TOKEN_SCRIPT).toContain('rawHeader(b"Authorization")')
    // Aucune émission réseau, aucune écriture, aucune exécution de commande.
    for (const forbidden of ['QgsNetworkAccessManager', 'requests.', 'urllib', 'subprocess', 'os.system', 'open(', 'exec(', 'eval(']) {
      expect(QGIS_TOKEN_SCRIPT, forbidden).not.toContain(forbidden)
    }
  })

  it('cible uniquement le service d’extraction de la Géoplateforme', () => {
    const urls = QGIS_TOKEN_SCRIPT.match(/https?:\/\/[^"')\s]+/g) ?? []
    expect(urls).toEqual(['https://data.geopf.fr/extraction/processes'])
  })
})
