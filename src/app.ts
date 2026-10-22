import { describeWmtsLayer } from './api/wmts'
import { auth, handleRedirect, oidcConfigured, startLogin } from './auth/auth'
import { errorMessage, isAborted } from './api/http'
import { $, copyText, esc, saveTextFile } from './components/dom'
import { openModal } from './components/modal'
import { hasGeoservices, renderDataset, renderSearch, visibleDatasets } from './components/views'
import { ExtractionController } from './extraction/controller'
import { defaultLayer, groupByLayer } from './gis/capabilities'
import { gisIntegration } from './gis/GISIntegrationService'
import { MapView } from './map/mapView'
import { geoPlatform } from './services/GeoPlatformService'
import { SemanticSearch } from './search/semantic'
import { CONCEPTS } from './search/thesaurus'
import { checkCoverage } from './services/coverage'
import { Store, initialExtraction, type AppState, type GetTab } from './state/store'
import type { Area } from './types'
import { bboxToPolygon, createArea, isValidBBox, type Geometry } from './utils/geo'

const store = new Store()
const extraction = new ExtractionController(store, auth)
const semantic = new SemanticSearch()
const SEMANTIC_KEY = 'da_semantic'
let mapView: MapView

/** Un contrôleur par opération asynchrone : lancer la suivante annule la précédente. */
const controllers: Record<string, AbortController | undefined> = {}
function begin(key: string): AbortSignal {
  controllers[key]?.abort()
  const c = new AbortController()
  controllers[key] = c
  return c.signal
}

const debounce = <A extends unknown[]>(fn: (...a: A) => void, ms: number) => {
  let t: ReturnType<typeof setTimeout>
  return (...a: A) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }
}

/* ------------------------------------------------------------------ recherche */

/** Active la recherche intelligente : le choix est mémorisé (par navigateur) pour ne pas redemander. */
function enableSemantic(): void {
  try {
    localStorage.setItem(SEMANTIC_KEY, '1')
  } catch {
    /* stockage indisponible : l'activation vaut pour cette session */
  }
  store.set({ semantic: { ...store.get().semantic, enabled: true } })
  void semantic.enable()
}


async function runSearch(query: string): Promise<void> {
  const signal = begin('search')
  // Le bandeau des besoins se replie dès qu'on cherche, et se rouvre si la saisie est vidée.
  store.set({ query, needsOpen: !query.trim(), search: { status: 'loading' } })
  try {
    // Recherche sémantique locale (si activée et prête) : vectorisation de la saisie, sans réseau.
    let semanticHits: Awaited<ReturnType<typeof semantic.search>> = []
    if (store.get().semantic.enabled && semantic.ready) {
      try {
        semanticHits = await semantic.search(query)
      } catch (error) {
        console.warn('Recherche sémantique ignorée :', error)
      }
    }
    const out = await geoPlatform.searchDatasets(query, { signal, size: 30, semanticHits })
    store.set({ semantic: { ...store.get().semantic, added: out.semantic.added, boosted: out.semantic.boosted } })
    store.set({
      search: out.datasets.length
        ? { status: 'ready', data: { ...out, failures: out.failures.map((f) => `${f.source === 'catalogue' ? 'Catalogue' : 'Index de recherche'} : ${f.message}`) } }
        : { status: 'empty', message: 'Aucune donnée ne correspond à votre recherche.' },
    })
  } catch (error) {
    if (isAborted(error)) return
    store.set({ search: { status: 'error', message: errorMessage(error) } })
  }
}

function selectDataset(dataset: AppState['dataset']): void {
  const layers = dataset ? groupByLayer(dataset.services) : []
  extraction.reset()
  store.set({
    dataset,
    tab: defaultTab(dataset),
    zoneOpen: false,
    coverage: undefined,
    layer: defaultLayer(layers)?.layer,
    resourceId: dataset?.downloads[0]?.id,
    format: undefined,
    date: undefined,
    preview: { status: 'idle' },
    download: { status: 'idle' },
    gis: {},
    extraction: initialExtraction,
  })
  void refreshPreview()
  void refreshDownloads()
  void refreshCoverage()
  if (dataset && store.get().tab === 'extract') void extraction.loadProcesses(dataset)
}

async function refreshPreview(): Promise<void> {
  const { dataset, layer } = store.get()
  const signal = begin('preview')
  mapView.clearPreview()
  if (!dataset) return store.set({ preview: { status: 'idle' } })
  const access = groupByLayer(dataset.services).find((l) => l.layer === layer)?.services.find((s) => s.kind === 'WMTS' || s.kind === 'WMS')
  if (!access) {
    return store.set({ preview: { status: 'empty', message: 'Aucun service d’affichage ouvert pour cette donnée : pas d’aperçu sur la carte.' } })
  }
  store.set({ preview: { status: 'loading' } })
  try {
    await mapView.showPreview(access, signal)
    if (signal.aborted) return
    mapView.onPreviewError(() => store.set({ preview: { status: 'error', message: 'Le service cartographique ne répond pas correctement (tuiles en erreur).' } }))
    store.set({ preview: { status: 'ready' } })
  } catch (error) {
    if (isAborted(error)) return
    store.set({ preview: { status: 'error', message: errorMessage(error) } })
  }
}

/* ----------------------------------------------------------------------- zone */

function setArea(area: Area | undefined, options: { fit?: boolean } = {}): void {
  mapView.showArea(area?.geometry)
  if (area && options.fit) mapView.fitBBox(area.bbox)
  store.set({
    area,
    areaMessage: undefined,
    adminZones: { status: area ? 'loading' : 'idle' },
    download: { status: 'idle' },
    zoneOpen: false,
  })
  void refreshAdminZones()
  void refreshCoverage()
}

async function refreshAdminZones(): Promise<void> {
  const { area } = store.get()
  const signal = begin('admin')
  if (!area) return
  try {
    const zones = await geoPlatform.getAdminZones(area.geometry, { signal })
    store.set({
      adminZones: zones.length
        ? { status: 'ready', data: zones }
        : { status: 'empty', message: 'La zone ne rencontre aucun département français : aucune donnée Géoplateforme à télécharger.' },
    })
    void refreshDownloads()
  } catch (error) {
    if (isAborted(error)) return
    store.set({ adminZones: { status: 'error', message: errorMessage(error) } })
  }
}

async function refreshDownloads(): Promise<void> {
  const { dataset, resourceId, area, adminZones, format, date } = store.get()
  const signal = begin('download')
  if (!dataset || dataset.downloads.length === 0 || !area || adminZones.status !== 'ready' || !adminZones.data) {
    return store.set({ download: { status: 'idle' } })
  }
  const resource = dataset.downloads.find((d) => d.id === resourceId) ?? dataset.downloads[0]
  store.set({ download: { status: 'loading' } })
  try {
    const data = await geoPlatform.getDownloadResources(resource, adminZones.data, { format, date })
    if (signal.aborted) return
    if (data.files.length === 0) {
      return store.set({ download: { status: 'empty', data, message: 'Aucun fichier n’est disponible pour cette zone avec ces choix.' } })
    }
    store.set({
      download: data.uncovered.length
        ? { status: 'partial', data, message: `Pas de données pour : ${data.uncovered.map((z) => z.name).join(', ')}.` }
        : { status: 'ready', data },
    })
  } catch (error) {
    if (isAborted(error)) return
    store.set({ download: { status: 'error', message: errorMessage(error) } })
  }
}

const AREA_LABELS: Record<Area['source'], string> = {
  viewport: 'Emprise de la carte',
  rectangle: 'Rectangle dessiné',
  polygon: 'Polygone dessiné',
  place: 'Territoire',
}

function useViewport(): void {
  const bbox = mapView.getViewportBBox()
  const b: [number, number, number, number] = [Math.max(bbox[0], -180), Math.max(bbox[1], -85), Math.min(bbox[2], 180), Math.min(bbox[3], 85)]
  setArea(createArea(bboxToPolygon(b), 'viewport', AREA_LABELS.viewport))
}

function startDrawing(mode: 'rectangle' | 'polygon'): void {
  store.set({ drawing: mode })
  mapView.startDraw(mode, (geometry) => {
    store.set({ drawing: undefined })
    setArea(createArea(geometry as Geometry, mode, AREA_LABELS[mode]))
  })
}

function cancelDrawing(): void {
  mapView.stopDraw()
  store.set({ drawing: undefined })
}

async function chooseAreaFromPlace(i: number): Promise<void> {
  const place = store.get().places.data?.[i]
  if (!place) return
  store.set({ places: { status: 'idle' }, areaMessage: undefined })
  mapView.centerOn(place.lon, place.lat)
  const signal = begin('place')
  try {
    const area = await geoPlatform.placeToArea(place, { signal })
    if (!area) {
      store.set({ areaMessage: `Le contour de « ${place.label} » n’est pas disponible : déplacez la carte puis utilisez « Emprise actuelle ».` })
      return
    }
    setArea(area, { fit: true })
  } catch (error) {
    if (isAborted(error)) return
    store.set({ areaMessage: `Impossible de récupérer le contour : ${errorMessage(error)}` })
  }
}

const searchPlaces = debounce(async (query: string) => {
  const signal = begin('places')
  if (query.trim().length < 2) return store.set({ places: { status: 'idle' } })
  store.set({ places: { status: 'loading' } })
  try {
    const places = await geoPlatform.searchPlaces(query, { signal })
    store.set({ places: places.length ? { status: 'ready', data: places } : { status: 'empty', message: 'Aucun lieu trouvé.' } })
  } catch (error) {
    if (isAborted(error)) return
    store.set({ places: { status: 'error', message: errorMessage(error) } })
  }
}, 300)

/* ---------------------------------------------------------------- navigation */

/** Onglet d'arrivée : les géoservices s'utilisent sans zone, donc passent en premier. */
function defaultTab(d?: AppState['dataset']): GetTab {
  if (hasGeoservices(d)) return 'gis'
  return d && d.downloads.length ? 'download' : 'extract'
}

/** La zone sert à vérifier la couverture du service (emprise annoncée par le WMTS, sinon celle de la fiche). */
async function refreshCoverage(): Promise<void> {
  const { dataset, area, layer } = store.get()
  const signal = begin('coverage')
  if (!dataset || !area) return store.set({ coverage: { status: 'idle' } })
  store.set({ coverage: { status: 'loading' } })
  const wmts = groupByLayer(dataset.services).find((l) => l.layer === layer)?.services.find((s) => s.kind === 'WMTS')
  let bbox
  if (wmts?.capabilitiesUrl) {
    try {
      bbox = (await describeWmtsLayer(wmts.capabilitiesUrl, wmts.layer, signal))?.bbox
    } catch (error) {
      if (isAborted(error)) return
    }
  }
  if (signal.aborted) return
  store.set({ coverage: checkCoverage(area, dataset, bbox) })
}

function maybeLoadExtraction(): void {
  const { dataset, extraction: x } = store.get()
  if (dataset && auth.authenticated && x.processes.status === 'idle') void extraction.loadProcesses(dataset)
}

/* -------------------------------------------------------------------- compte */

function openAuthModal(): void {
  const render = () => {
    if (auth.authenticated) {
      const left = auth.secondsLeft
      return `<p>Connecté${auth.userLabel ? ` : <strong>${esc(auth.userLabel)}</strong>` : ''}.</p>
        <p class="fr-text--sm">${left === null ? 'Expiration du jeton inconnue.' : `Le jeton expire dans environ ${Math.max(1, Math.round(left / 60))} min.`}</p>
        <button type="button" class="fr-btn" data-act="logout">Se déconnecter</button>`
    }
    return `${oidcConfigured() ? `<p><button type="button" class="fr-btn" data-act="oidc-login">Se connecter avec la Géoplateforme</button></p><p class="fr-text--sm">ou collez un jeton :</p>` : `<div class="fr-callout fr-callout--sm"><p class="fr-callout__text">La connexion automatique n’est pas disponible : elle exige un client OAuth2 enregistré auprès de la Géoplateforme pour cette adresse (voir le README). Collez un jeton d’accès à la place.</p></div>`}
      <form id="da-token-form" novalidate>
        <div class="fr-input-group"><label class="fr-label" for="da-token">Jeton d’accès (Bearer)
          <span class="fr-hint-text">Obtenu depuis le bouton « Authorize » du Swagger d’extraction (data.geopf.fr/extraction/swagger-ui). Il reste dans ce navigateur et n’est envoyé qu’à data.geopf.fr.</span></label>
          <textarea class="fr-input" id="da-token" rows="3" autocomplete="off" spellcheck="false"></textarea></div>
        <div class="fr-checkbox-group"><input type="checkbox" id="da-token-remember"><label class="fr-label" for="da-token-remember">Le conserver pour cet onglet (sessionStorage)</label></div>
        <div id="da-token-error" aria-live="polite"></div>
        <button type="submit" class="fr-btn">Valider</button>
      </form>`
  }
  const modal = openModal({ title: 'Connexion à la Géoplateforme', body: `<div id="da-auth-body">${render()}</div>` })
  const body = modal.querySelector<HTMLElement>('#da-auth-body')!
  body.addEventListener('submit', (e) => {
    e.preventDefault()
    const raw = (body.querySelector('#da-token') as HTMLTextAreaElement).value
    auth.setToken(raw, (body.querySelector('#da-token-remember') as HTMLInputElement).checked)
    if (!auth.authenticated) {
      auth.clear()
      body.querySelector('#da-token-error')!.innerHTML = '<p class="fr-error-text">Jeton vide ou expiré.</p>'
      return
    }
    body.innerHTML = render()
  })
  body.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act
    if (act === 'logout') {
      auth.clear()
      body.innerHTML = render()
    } else if (act === 'oidc-login') void startLogin()
  })
}

function onAuthChanged(): void {
  const btn = $('#da-auth-btn')
  btn.textContent = auth.authenticated ? `Connecté${auth.userLabel ? ` · ${auth.userLabel}` : ''}` : 'Se connecter'
  btn.className = `fr-btn ${auth.authenticated ? 'fr-btn--secondary' : ''} fr-icon-account-circle-line fr-btn--icon-left`
  extraction.reset()
  store.set({ authVersion: store.get().authVersion + 1, extraction: initialExtraction })
  const { dataset, tab } = store.get()
  if (dataset && tab === 'extract') void extraction.loadProcesses(dataset)
}

/* ------------------------------------------------------------------ événements */

type Handler = (el: HTMLElement) => void | Promise<void>

const gisAction = async (key: string): Promise<void> => {
  const s = store.get()
  const d = s.dataset!
  const [client, id] = key.split(':')
  const o = gisIntegration.getOptions({ resource: d, availableServices: d.services, selectedArea: s.area, selectedLayer: s.layer })
  const action = o.clients.find((c) => c.id === client)?.actions.find((a) => a.id === id)
  if (!action) return
  store.set({ gis: { result: { kind: 'loading', title: 'Préparation…' } } })
  try {
    const out = await action.run()
    if (out.kind === 'file') {
      saveTextFile(out.fileName, out.mimeType, out.content)
      store.set({ gis: { result: { kind: 'success', title: `Fichier « ${out.fileName} » téléchargé`, text: 'Ouvrez-le dans QGIS (double-clic ou glisser-déposer sur la carte).' } } })
    } else {
      const ok = await copyText(out.text)
      store.set({ gis: { result: { kind: ok ? 'success' : 'warning', title: ok ? 'Copié dans le presse-papiers' : 'Copie automatique impossible : copiez le texte ci-dessous.', code: out.text } } })
    }
  } catch (error) {
    store.set({ gis: { result: { kind: 'error', title: 'Action impossible', text: errorMessage(error) } } })
  }
}

const handlers: Record<string, Handler> = {
  back: () => {
    selectDataset(undefined)
    requestAnimationFrame(() => document.getElementById('da-search-input')?.focus())
  },
  need: (el) => {
    const c = CONCEPTS.find((x) => x.id === el.dataset.id)
    if (!c) return
    store.set({ query: c.label })
    void runSearch(c.label)
  },
  'open-zone': () => {
    store.set({ zoneOpen: true })
    requestAnimationFrame(() => document.getElementById('da-zone-h')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  },
  'close-zone': () => store.set({ zoneOpen: false }),
  pick: (el) => {
    const d = visibleDatasets(store.get()).find((x) => x.id === el.dataset.id)
    if (d) {
      selectDataset(d)
      requestAnimationFrame(() => document.getElementById('da-dataset-title')?.focus())
    }
  },
  'clear-area': () => setArea(undefined),
  filter: (el) => {
    const key = el.dataset.filter as keyof AppState['filters']
    const f = store.get().filters
    store.set({ filters: { ...f, [key]: !f[key] } })
  },
  'semantic-on': () => enableSemantic(),
  'semantic-off': () => {
    try {
      localStorage.removeItem(SEMANTIC_KEY)
    } catch {
      /* stockage indisponible */
    }
    store.set({ semantic: { ...store.get().semantic, enabled: false, added: 0, boosted: 0 } })
    if (store.get().query.trim()) void runSearch(store.get().query)
  },
  'use-viewport': useViewport,
  'draw-rect': () => startDrawing('rectangle'),
  'draw-poly': () => startDrawing('polygon'),
  'cancel-draw': cancelDrawing,
  'pick-place': (el) => chooseAreaFromPlace(Number(el.dataset.i)),
  tab: (el) => {
    store.set({ tab: el.dataset.tab as GetTab })
    if (el.dataset.tab === 'extract') maybeLoadExtraction()
  },
  'download-first': () => {
    const file = store.get().download.data?.files[0]
    if (!file) return
    const a = document.createElement('a')
    a.href = file.url
    a.download = file.fileName
    a.rel = 'noopener'
    document.body.append(a)
    a.click()
    a.remove()
  },
  'copy-links': async (el) => {
    const files = store.get().download.data?.files ?? []
    el.textContent = (await copyText(files.map((f) => f.url).join('\n'))) ? 'Liens copiés ✓' : 'Copie impossible'
  },
  'copy-service': async (el) => {
    const x = store.get().dataset!.services[Number(el.dataset.i)]
    el.textContent = (await copyText(x.capabilitiesUrl ?? x.endpoint)) ? 'Copié ✓' : 'Copie impossible'
  },
  'copy-email': async (el) => {
    el.textContent = (await copyText(el.dataset.email ?? '')) ? 'Adresse copiée ✓' : 'Copie impossible'
  },
  'gis-run': (el) => gisAction(el.dataset.gis!),
  login: openAuthModal,
  'extract-reload': () => {
    const d = store.get().dataset
    if (d) void extraction.loadProcesses(d)
  },
  'tables-all': () => extraction.setAllTables(true),
  'tables-none': () => extraction.setAllTables(false),
  'extract-launch': () => extraction.launch(),
  'extract-cancel': () => extraction.cancel(),
  'copy-report': async (el) => {
    const report = store.get().extraction.error?.report
    if (report) el.textContent = (await copyText(report)) ? 'Rapport copié ✓' : 'Copie impossible'
  },
  'toggle-panel': () => {
    const collapsed = !store.get().panelCollapsed
    store.set({ panelCollapsed: collapsed })
    document.body.classList.toggle('da-panel-collapsed', collapsed)
    setTimeout(() => mapView.map.updateSize(), 250)
  },
}

function bindEvents(): void {
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')
    if (!el || el.closest('#da-modal-root') || !mapView) return
    const handler = handlers[el.dataset.act!]
    if (handler) void handler(el)
  })
  $('#da-auth-btn').addEventListener('click', openAuthModal)
  auth.subscribe(onAuthChanged)

  // L'événement `toggle` ne remonte pas : écoute en capture pour mémoriser l'état du bandeau des besoins.
  document.addEventListener(
    'toggle',
    (e) => {
      const el = e.target as HTMLDetailsElement
      if (el.classList?.contains('da-needs') && el.open !== store.get().needsOpen) store.set({ needsOpen: el.open })
    },
    true,
  )

  document.addEventListener('submit', (e) => {
    const form = e.target as HTMLFormElement
    if (form.id === 'da-search-form') {
      e.preventDefault()
      void runSearch((form.elements.namedItem('q') as HTMLInputElement).value)
    } else if (form.id === 'da-bbox-form') {
      e.preventDefault()
      const v = (n: string) => Number.parseFloat((form.elements.namedItem(n) as HTMLInputElement).value.replace(',', '.'))
      const bbox: [number, number, number, number] = [v('ouest'), v('sud'), v('est'), v('nord')]
      if (!isValidBBox(bbox)) {
        $('#da-bbox-error').innerHTML = '<p class="fr-error-text" role="alert">Coordonnées invalides : ouest &lt; est, sud &lt; nord (longitude −180 à 180, latitude −90 à 90).</p>'
        return
      }
      setArea(createArea(bboxToPolygon(bbox), 'rectangle', 'Coordonnées saisies'), { fit: true })
    }
  })

  const liveSearch = debounce((q: string) => void runSearch(q), 400)
  document.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement
    if (t.id === 'da-search-input') {
      store.set({ query: t.value }) // conserve la saisie entre deux rendus
      if (t.value.trim().length >= 2) liveSearch(t.value)
    } else if (t.id === 'da-place-input') searchPlaces(t.value)
  })

  document.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement & HTMLInputElement
    const field = t.dataset.field
    if (t.id === 'da-layer') {
      store.set({ layer: t.value })
      void refreshPreview()
      void refreshCoverage()
    } else if (t.id === 'da-gis-layer') {
      store.set({ layer: t.value, gis: {} })
      void refreshCoverage()
    }
    else if (t.id === 'da-date') {
      store.set({ date: t.value || undefined })
      void refreshDownloads()
    } else if (t.id === 'da-format') {
      store.set({ format: t.value, date: undefined })
      void refreshDownloads()
    } else if (t.id === 'da-resource') {
      store.set({ resourceId: t.value, format: undefined, date: undefined })
      void refreshDownloads()
    } else if (t.id === 'da-process') {
      if (t.value) void extraction.chooseProcess(t.value)
    } else if (t.dataset.actChange === 'table') extraction.toggleTable(t.dataset.table!)
    else if (t.dataset.actChange === 'field' && field) extraction.setValue(field, t.value)
    else if (t.dataset.actChange === 'field-bool' && field) extraction.setValue(field, t.checked)
  })

  // Onglets : navigation aux flèches (motif WAI-ARIA).
  document.addEventListener('keydown', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]')
    if (!tab || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
    const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    next.click()
    requestAnimationFrame(() => document.getElementById(next.id)?.focus())
  })
}

/** Conserve focus, caret, ouverture des <details> et saisies des coordonnées malgré le re-rendu. */
function preserveUi(render: () => void): void {
  const active = document.activeElement as HTMLInputElement | null
  const id = active?.id
  const caret = active?.selectionStart ?? null
  const details = [...document.querySelectorAll<HTMLDetailsElement>('#da-step-content details:not(.da-needs)')].map((d) => d.open)
  const bbox = [...document.querySelectorAll<HTMLInputElement>('#da-bbox-form input')].map((i) => i.value)
  const scroll = document.getElementById('da-panel')?.scrollTop ?? 0
  render()
  document.querySelectorAll<HTMLDetailsElement>('#da-step-content details:not(.da-needs)').forEach((d, n) => {
    if (details[n] !== undefined) d.open = details[n] || d.open
  })
  document.querySelectorAll<HTMLInputElement>('#da-bbox-form input').forEach((i, n) => (i.value = bbox[n] ?? ''))
  const panel = document.getElementById('da-panel')
  if (panel) panel.scrollTop = scroll
  if (id) {
    const el = document.getElementById(id) as HTMLInputElement | null
    if (el && el !== active) {
      el.focus({ preventScroll: true })
      if (caret !== null && el.tagName === 'INPUT') {
        try {
          el.setSelectionRange(caret, caret)
        } catch {
          /* type search : pas de sélection */
        }
      }
    }
  }
}

function renderAll(s: AppState): void {
  preserveUi(() => {
    const content = $('#da-step-content')
    content.innerHTML = s.dataset ? renderDataset(s) : renderSearch(s)
    content.setAttribute('aria-label', s.dataset ? 'Donnée choisie' : 'Recherche de données')
    $('#da-map-status').textContent = s.area ? `Zone : ${s.area.label}.` : ''
  })
}

export async function startApp(): Promise<void> {
  semantic.subscribe(() => {
    const cur = store.get().semantic
    store.set({ semantic: { ...cur, status: semantic.status, progress: semantic.progress, error: semantic.error } })
    // Dès que le modèle est prêt, la recherche en cours est refaite avec le sens.
    if (semantic.status === 'ready' && cur.enabled && store.get().query.trim()) void runSearch(store.get().query)
  })
  try {
    if (localStorage.getItem(SEMANTIC_KEY) === '1') enableSemantic()
  } catch {
    /* stockage indisponible */
  }
  bindEvents()
  // Retour d'une connexion OAuth2 (inactive sans client dédié).
  try {
    const token = await handleRedirect()
    if (token) auth.setToken(token, true)
  } catch (error) {
    console.warn(errorMessage(error))
  }
  onAuthChanged()

  store.subscribe((s) => renderAll(s))
  renderAll(store.get())

  mapView = await MapView.create($('#da-map'))
  $('#da-map-status').dataset.ext = String(mapView.extensionsLoaded)
  if (import.meta.env.DEV) (window as unknown as { __da: unknown }).__da = { mapView, store }

  const initial = new URLSearchParams(location.search).get('donnee')
  if (initial) {
    store.set({ search: { status: 'loading' } })
    geoPlatform
      .getDataset(initial)
      .then((d) => (d ? selectDataset(d) : store.set({ search: { status: 'empty', message: `Donnée « ${initial} » introuvable.` } })))
      .catch((e) => store.set({ search: { status: 'error', message: errorMessage(e) } }))
  } else {
    void runSearch('')
  }
}
