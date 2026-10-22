/**
 * Authentification : jeton Bearer collé à la main (fonctionne dès aujourd'hui) et
 * OAuth2 Authorization Code + PKCE (RFC 7636), inactif sans client dédié (cf. config.ts).
 * Le jeton reste en mémoire, ou en sessionStorage si l'utilisateur le demande (jamais
 * localStorage), et n'est envoyé qu'à data.geopf.fr.
 */
import { OIDC } from '../config'

const SESSION_KEY = 'da_token'
const PKCE_KEY = 'da_pkce'

export function base64url(bytes: Uint8Array): string {
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface JwtClaims {
  exp?: number
  preferred_username?: string
  name?: string
  email?: string
  [key: string]: unknown
}

/** Lit les revendications d'un JWT SANS vérifier la signature (affichage seulement). */
export function decodeJwt(token: string): JwtClaims | null {
  try {
    const payload = token.split('.')[1]
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (payload.length % 4)) % 4)
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))))
  } catch {
    return null
  }
}

export class AuthState {
  private _token = ''
  private listeners = new Set<() => void>()

  constructor(private readonly storage: Storage | undefined = safeSession()) {
    try {
      this._token = storage?.getItem(SESSION_KEY) ?? ''
    } catch {
      /* sessionStorage indisponible : mémoire seulement */
    }
  }

  get token(): string {
    return this._token
  }

  get claims(): JwtClaims | null {
    return this._token ? decodeJwt(this._token) : null
  }

  /** Secondes avant expiration ; `null` si inconnue, négatif si expiré. */
  get secondsLeft(): number | null {
    const exp = this.claims?.exp
    return typeof exp === 'number' ? Math.round(exp - Date.now() / 1000) : null
  }

  get authenticated(): boolean {
    const left = this.secondsLeft
    return !!this._token && (left === null || left > 0)
  }

  get userLabel(): string | undefined {
    const c = this.claims
    return c?.name || c?.preferred_username || c?.email
  }

  setToken(raw: string, remember = false): void {
    this._token = raw.trim().replace(/^Bearer\s+/i, '')
    try {
      if (remember && this._token) this.storage?.setItem(SESSION_KEY, this._token)
      else this.storage?.removeItem(SESSION_KEY)
    } catch {
      /* ignoré */
    }
    this.listeners.forEach((l) => l())
  }

  clear(): void {
    this.setToken('')
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

function safeSession(): Storage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

/* ---------------------------------------------------------------- PKCE */

export function generateVerifier(): string {
  const bytes = new Uint8Array(48)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

export async function challengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

export const oidcConfigured = (): boolean => !!OIDC.clientId
const redirectUri = () => location.origin + location.pathname

export async function startLogin(): Promise<void> {
  if (!OIDC.clientId) throw new Error('Aucun client OAuth2 configuré.')
  const verifier = generateVerifier()
  const state = generateVerifier().slice(0, 24)
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, returnTo: location.search }))
  const params = new URLSearchParams({
    client_id: OIDC.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: OIDC.scope,
    state,
    code_challenge: await challengeS256(verifier),
    code_challenge_method: 'S256',
  })
  location.assign(`${OIDC.authorizeUrl}?${params}`)
}

/** À appeler au chargement : termine l'échange si la page revient de l'authentification. */
export async function handleRedirect(): Promise<string | null> {
  if (!OIDC.clientId) return null
  const query = new URLSearchParams(location.search)
  const code = query.get('code')
  if (!code) return null
  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? 'null') as { verifier: string; state: string } | null
  sessionStorage.removeItem(PKCE_KEY)
  history.replaceState(null, '', redirectUri())
  if (!saved || saved.state !== query.get('state')) throw new Error('Réponse d’authentification inattendue (state).')
  const response = await fetch(OIDC.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: OIDC.clientId,
      code,
      redirect_uri: redirectUri(),
      code_verifier: saved.verifier,
    }),
  })
  if (!response.ok) throw new Error(`Échange du code refusé (HTTP ${response.status}).`)
  return ((await response.json()) as { access_token?: string }).access_token ?? null
}

export const auth = new AuthState()
