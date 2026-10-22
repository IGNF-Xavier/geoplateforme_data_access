/**
 * Script à coller dans l'éditeur de la console Python de QGIS. Il demande à QGIS d'ajouter,
 * à une requête vers le service d'extraction, l'en-tête d'authentification de chacune de vos
 * configurations (par exemple celle créée par le plugin Géoplateforme pour QGIS), et affiche
 * le résultat : le jeton est la valeur après « Bearer ». Rien n'est envoyé : la requête n'est
 * jamais émise, seul l'en-tête est lu localement.
 */
export const QGIS_TOKEN_SCRIPT = `from qgis.core import QgsApplication
from qgis.PyQt.QtCore import QUrl
from qgis.PyQt.QtNetwork import QNetworkRequest

am = QgsApplication.authManager()
for cid, cfg in am.availableAuthMethodConfigs().items():
    r = QNetworkRequest(QUrl("https://data.geopf.fr/extraction/processes"))
    am.updateNetworkRequest(r, cid)
    h = bytes(r.rawHeader(b"Authorization")).decode()
    print(cfg.name(), "|", cid, "|", h or "(pas de jeton)")`
