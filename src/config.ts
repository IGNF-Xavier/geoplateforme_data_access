/**
 * Configuration. Aucun secret : ce fichier est publié tel quel.
 *
 * Connexion automatique (OAuth2 Authorization Code + PKCE) : elle n'est active que si
 * un client OAuth2 public a été enregistré côté Géoplateforme avec l'URL de cette
 * application comme URI de redirection, puis renseigné dans `VITE_OIDC_CLIENT_ID`.
 * Vérifié le 2026-10-21 : les clients existants (`cartes-gouv-public`, `gpf-swagger`)
 * refusent une redirection vers une autre origine (HTTP 400). Sans client dédié,
 * l'application accepte un jeton Bearer collé à la main.
 */
export const OIDC = {
  clientId: (import.meta.env.VITE_OIDC_CLIENT_ID as string | undefined) || undefined,
  authorizeUrl: 'https://sso.geopf.fr/realms/geoplateforme/protocol/openid-connect/auth',
  tokenUrl: 'https://sso.geopf.fr/realms/geoplateforme/protocol/openid-connect/token',
  scope: 'openid',
}

export const EXTRACTION_BASE = 'https://data.geopf.fr/extraction'

/** Lot de configuration Géoplateforme lu par les extensions OpenLayers (couches, projections). */
export const GEOPF_CONFIG_KEY = 'essentiels'

/**
 * Poids visé pour tous les filtres spatiaux d'une requête d'extraction : le service
 * refuse une requête de plus de ≈ 256 Ko (mesuré entre 256 500 et 262 000 octets).
 */
export const EXTRACTION_BUDGET_BYTES = 200_000

export const JOB_POLL_INTERVAL_MS = 15_000
