/**
 * Rendu HTML (DSFR) des étapes. Fonctions pures état → chaîne : les événements sont
 * gérés par délégation dans app.ts via les attributs `data-act`.
 */
import { auth } from '../auth/auth'
import { fieldEnum, fieldType, isFailed, isRunning, isSuccessful } from '../extraction/models'
import { editableFields } from '../extraction/builder'
import { defaultLayer, groupByLayer, restrictedServices } from '../gis/capabilities'
import { gisIntegration } from '../gis/GISIntegrationService'
import { SEMANTIC_DOWNLOAD_MB } from '../search/semantic'
import { CONCEPTS } from '../search/thesaurus'
import type { AppState } from '../state/store'
import { accessLevel, type Dataset } from '../types'
import { formatArea, formatBBox, formatBytes } from '../utils/geo'
import { cleanEmail, mailtoLink } from '../api/catalogue'
import { alertHtml, esc, formatDate, loadingHtml } from './dom'

/* ---------------------------------------------------------------- accès / badges */

export function datasetBadges(d: Dataset): string {
  const level = accessLevel(d)
  const gis = groupByLayer(d.services).length > 0
  return [
    d.downloads.length ? '<span class="fr-badge fr-badge--sm fr-badge--green-emeraude">Téléchargeable</span>' : '',
    gis ? '<span class="fr-badge fr-badge--sm fr-badge--blue-ecume">Utilisable en SIG</span>' : '',
    level === 'restricted'
      ? '<span class="fr-badge fr-badge--sm fr-badge--warning">Accès restreint</span>'
      : level === 'partial'
        ? '<span class="fr-badge fr-badge--sm fr-badge--info">Accès libre et restreint</span>'
        : '',
    !d.downloads.length && !gis && level === 'none' ? '<span class="fr-badge fr-badge--sm">Consultation seule</span>' : '',
  ].join('')
}

/**
 * Contact du producteur : uniquement ce que les métadonnées publient. L'adresse courriel
 * n'est pas toujours renseignée (surtout pour les couches de l'index) : on le dit plutôt
 * que d'en déduire une.
 */
export function renderContacts(d: Dataset): string {
  const contacts = d.contacts ?? []
  const subject = `Demande d’information : ${d.title}`
  const rows = contacts
    .map((c) => {
      const mail = mailtoLink(c.email, subject)
      return `<li><strong>${esc(c.organisation ?? 'Producteur')}</strong>${c.role ? ` <span class="fr-hint-text">(${esc(c.role)})</span>` : ''}
        ${mail ? `<br><a href="${esc(mail)}">${esc(c.email)}</a> <button type="button" class="fr-btn fr-btn--tertiary-no-outline fr-btn--sm" data-act="copy-email" data-email="${esc(c.email)}">Copier l’adresse</button>` : ''}
        ${c.website ? `<br><a href="${esc(c.website)}" target="_blank" rel="noopener">Site du producteur<span class="fr-sr-only"> (nouvelle fenêtre)</span></a>` : ''}
        ${c.address ? `<br><span class="fr-text--sm">${esc(c.address)}</span>` : ''}</li>`
    })
    .join('')
  const hasMail = contacts.some((c) => cleanEmail(c.email))
  const missing = !contacts.length
    ? 'Aucun contact n’est renseigné dans les métadonnées de cette donnée.'
    : hasMail
      ? ''
      : 'Aucune adresse courriel n’est renseignée dans les métadonnées de cette donnée.'
  return `<section class="da-contact" id="da-contact" aria-labelledby="da-contact-h"><h4 id="da-contact-h" class="fr-h6">Contacter le producteur</h4>
    ${rows ? `<ul class="da-contact-list">${rows}</ul>` : ''}${missing ? `<p class="fr-text--sm">${esc(missing)}</p>` : ''}</section>`
}

function restrictedNotice(d: Dataset): string {
  const level = accessLevel(d)
  if (level !== 'restricted' && level !== 'partial') return ''
  const n = restrictedServices(d.services).length
  return alertHtml(
    'warning',
    level === 'restricted' ? 'Accès restreint' : 'Une partie des accès est restreinte',
    `${n} accès ${level === 'restricted' ? 'sont' : 'de cette donnée sont'} réservés (offre non ouverte de la Géoplateforme) : ils exigent des droits que cette application ne peut pas obtenir pour vous. Ils ne sont donc ni affichés sur la carte ni proposés en SIG. Pour demander l’accès, utilisez le contact du producteur ci-dessous.`,
  )
}

/* ------------------------------------------------------------------- stepper */

/** Les géoservices (WMS, WMTS, TMS…) s'utilisent sans zone : l'étape 3 est accessible dès qu'une donnée est choisie si elle en a. */
export const hasGeoservices = (d?: Dataset): boolean => !!d && groupByLayer(d.services).length > 0

/* -------------------------------------------------------------------- étape 1 */

function filtered(s: AppState): Dataset[] {
  const f = s.filters
  return (s.search.data?.datasets ?? []).filter(
    (d) =>
      (!f.downloadable || d.downloads.length > 0) &&
      (!f.gis || groupByLayer(d.services).length > 0) &&
      (!f.openOnly || accessLevel(d) !== 'restricted'),
  )
}

export function visibleDatasets(s: AppState): Dataset[] {
  return filtered(s)
}

function datasetFacts(d: Dataset): string {
  const facts: [string, string | undefined][] = [
    ['Producteur', d.producer],
    ['Type', d.type],
    ['Thème', d.theme],
    ['Édition', d.edition],
    ['Mise à jour', formatDate(d.updatedAt)],
    ['Couverture temporelle', d.temporalExtent?.start ? `${formatDate(d.temporalExtent.start)}${d.temporalExtent.end ? ` → ${formatDate(d.temporalExtent.end)}` : ''}` : undefined],
    ['Échelle', d.resolutions?.join(', ')],
    ['Licence', d.license],
    ['Source', d.source === 'catalogue' ? 'Catalogue Géoplateforme' : 'Index de recherche Géoplateforme'],
  ]
  return facts
    .filter(([, v]) => v)
    .map(([k, v]) => `<div class="da-fact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join('')
}

function renderDatasetCard(s: AppState, d: Dataset): string {
  const layers = groupByLayer(d.services).filter((l) => l.services.some((x) => x.kind === 'WMTS' || x.kind === 'WMS'))
  const previewMsg =
    s.preview.status === 'loading'
      ? loadingHtml('Chargement de l’aperçu…')
      : s.preview.status === 'error' || s.preview.status === 'empty'
        ? alertHtml(s.preview.status === 'error' ? 'warning' : 'info', s.preview.status === 'error' ? 'Aperçu indisponible' : 'Pas d’aperçu', s.preview.message)
        : ''
  const layerSelect =
    layers.length > 1
      ? `<div class="fr-select-group"><label class="fr-label" for="da-layer">Couche affichée sur la carte</label>
          <select class="fr-select" id="da-layer">${layers.map((l) => `<option value="${esc(l.layer)}"${l.layer === s.layer ? ' selected' : ''}>${esc(l.layer)}</option>`).join('')}</select></div>`
      : ''
  return `<div class="da-dataset-card">
      <h3 class="fr-h6" id="da-dataset-title" tabindex="-1">${esc(d.title)}</h3>
      <p class="da-badges" aria-label="Modes d’accès">${datasetBadges(d)}</p>
      ${restrictedNotice(d)}
      ${renderContacts(d)}
      ${d.abstract ? `<p class="da-lead">${esc(d.abstract.length > 170 ? `${d.abstract.slice(0, 170).trim()}…` : d.abstract)}</p>` : ''}
      <details class="da-details"><summary>Toutes les informations</summary>${d.abstract && d.abstract.length > 170 ? `<p class="da-abstract">${esc(d.abstract)}</p>` : ''}<dl class="da-facts">${datasetFacts(d)}</dl></details>
      ${layerSelect}
      <div aria-live="polite">${previewMsg}</div>
    </div>`
}

export function renderSearch(s: AppState): string {
  const f = s.filters
  const chip = (key: keyof typeof f, label: string) =>
    `<button type="button" class="da-filter" data-act="filter" data-filter="${key}" aria-pressed="${f[key]}">${label}</button>`
  const search = s.search
  const list = filtered(s)
  const analysis = search.data?.analysis
  let status = ''
  if (search.status === 'loading') status = loadingHtml('Recherche en cours…')
  else if (search.status === 'error') status = alertHtml('error', 'La recherche a échoué', search.message)
  else if (search.status === 'empty') status = alertHtml('info', 'Aucun résultat', search.message) + needsHtml('Essayez plutôt un besoin', true)
  else if (search.status === 'ready' && search.data) {
    const { catalogueTotal, indexCount, failures } = search.data
    status =
      (analysis?.concepts.length
        ? `<p class="da-understood" role="status">Besoin reconnu : ${analysis.concepts.map((c) => `<strong>${esc(c.label)}</strong>`).join(', ')} — les données les plus adaptées sont en tête.</p>`
        : '') +
      `<p class="fr-hint-text" role="status">${list.length} donnée${list.length > 1 ? 's' : ''} affichée${list.length > 1 ? 's' : ''}` +
      `${catalogueTotal ? ` · ${catalogueTotal.toLocaleString('fr-FR')} fiche${catalogueTotal > 1 ? 's' : ''} au catalogue` : ''}` +
      `${indexCount ? ` · ${indexCount} couche${indexCount > 1 ? 's' : ''} de l’index de recherche` : ''}.</p>` +
      failures.map((m) => alertHtml('warning', 'Résultats partiels', m)).join('')
    if (!list.length) status += alertHtml('info', 'Aucun résultat avec ces filtres', 'Désactivez un filtre pour élargir la liste.')
  }
  const items =
    search.status === 'ready'
      ? list
          .map(
            (d) => `<li><button type="button" class="da-result${s.dataset?.id === d.id ? ' is-selected' : ''}" data-act="pick" data-id="${esc(d.id)}">
              <span class="da-result-title">${esc(d.title)}</span>
              <span class="da-result-meta">${esc([d.producer, d.type].filter(Boolean).join(' · '))}</span>
              ${d.matchReason ? `<span class="da-result-why">${esc(d.matchReason)}</span>` : ''}
              <span class="da-badges">${datasetBadges(d)}</span></button></li>`,
          )
          .join('')
      : ''
  return `<form role="search" id="da-search-form" class="da-search" autocomplete="off">
      <label class="fr-label" for="da-search-input">Que cherchez-vous ?
        <span class="fr-hint-text">Décrivez en quelques mots ce que vous voulez (« bâtiments », « altitude », « photos aériennes »…) ou saisissez le nom d’un produit.</span></label>
      <div class="fr-search-bar">
        <input class="fr-input" type="search" id="da-search-input" name="q" value="${esc(s.query)}" placeholder="Ex. : forêts, routes, risque d’inondation, BD TOPO…" aria-describedby="da-search-status" />
        <button class="fr-btn" type="submit">Rechercher</button>
      </div>
      <div class="da-filters" role="group" aria-label="Filtrer les résultats">${chip('downloadable', 'Téléchargeable')}${chip('gis', 'Utilisable en SIG')}${chip('openOnly', 'Accès libre')}</div>
    </form>
    ${renderSemanticBox(s)}
    ${needsHtml('Ou partez d’un besoin', s.needsOpen)}
    <div id="da-search-status" aria-live="polite">${status}</div>
    <ul class="da-results" aria-label="Résultats de recherche">${items}</ul>`
}

/** Activation de la recherche intelligente (modèle exécuté dans le navigateur, téléchargé une fois). */
function renderSemanticBox(s: AppState): string {
  const m = s.semantic
  if (!m.enabled || m.status === 'off') {
    return `<div class="da-semantic"><p class="da-semantic-title"><strong>Recherche intelligente</strong> <span class="fr-badge fr-badge--sm">facultative</span></p>
      <p class="fr-text--sm">Comprend les formulations libres (« photos prises d’avion », « stations de recharge ») en plus des mots-clés. Calculée dans votre navigateur : vos saisies ne sont envoyées à aucun service externe. Téléchargement unique d’environ ${SEMANTIC_DOWNLOAD_MB} Mo.</p>
      <button type="button" class="fr-btn fr-btn--secondary fr-btn--sm" data-act="semantic-on">Activer la recherche intelligente</button></div>`
  }
  if (m.status === 'loading') {
    return `<div class="da-semantic" role="status"><p class="da-semantic-title"><strong>Recherche intelligente</strong> — ${esc(m.progress.label || 'chargement')}…</p>
      <progress max="100" value="${m.progress.percent}" aria-label="Chargement du modèle">${m.progress.percent} %</progress>
      <p class="fr-hint-text">La recherche par mots-clés reste utilisable pendant ce temps.</p></div>`
  }
  if (m.status === 'error') {
    return `<div class="da-semantic">${alertHtml('warning', 'Recherche intelligente indisponible', `${m.error ?? 'Erreur inconnue'} La recherche par mots-clés continue de fonctionner.`)}
      <button type="button" class="fr-btn fr-btn--tertiary fr-btn--sm" data-act="semantic-on">Réessayer</button></div>`
  }
  const gain = m.added + m.boosted > 0 ? ` — ${m.boosted} résultat${m.boosted > 1 ? 's' : ''} remonté${m.boosted > 1 ? 's' : ''}, ${m.added} ajouté${m.added > 1 ? 's' : ''} pour cette recherche` : ''
  return `<div class="da-semantic is-on"><p class="fr-text--sm"><span class="fr-badge fr-badge--sm fr-badge--success">Recherche intelligente activée</span>${esc(gain)}
    <button type="button" class="fr-btn fr-btn--tertiary-no-outline fr-btn--sm" data-act="semantic-off">Désactiver</button></p></div>`
}

/** Suggestions de recherche : les besoins du thésaurus. */
function needsHtml(title: string, open: boolean): string {
  return `<details class="da-needs"${open ? ' open' : ''}><summary>${esc(title)} <span class="da-needs-count">${CONCEPTS.length} besoins</span></summary>
    <div class="da-needs-grid">${CONCEPTS.map(
      (c) => `<button type="button" class="da-need" data-act="need" data-id="${esc(c.id)}"><strong>${esc(c.label)}</strong><small>${esc(c.hint)}</small></button>`,
    ).join('')}</div></details>`
}

/** Fiche de la donnée : détails, zone facultative, puis modes de récupération. */
export function renderDataset(s: AppState): string {
  const d = s.dataset!
  return `<button type="button" class="fr-btn fr-btn--tertiary fr-btn--sm fr-icon-arrow-left-line fr-btn--icon-left" data-act="back">Retour aux résultats</button>
    ${renderDatasetCard(s, d)}
    ${renderTabs(s)}
    ${renderZoneBox(s)}`
}

/* -------------------------------------------------------------------- zone (facultative) */

function renderCoverage(s: AppState): string {
  const c = s.coverage
  if (!s.area || !c || c.status === 'idle') return ''
  if (c.status === 'loading') return loadingHtml('Vérification de la couverture…')
  const kind = c.status === 'covered' ? 'success' : c.status === 'outside' ? 'warning' : 'info'
  const title = c.status === 'covered' ? 'Zone couverte' : c.status === 'outside' ? 'Zone hors de l’emprise annoncée' : 'Couverture non vérifiable'
  return alertHtml(kind, title, c.text)
}

function zoneTools(s: AppState): string {
  const drawing = s.drawing
  const places =
    s.places.status === 'loading'
      ? loadingHtml('Recherche…')
      : s.places.status === 'error'
        ? alertHtml('error', 'Recherche de lieu impossible', s.places.message)
        : s.places.status === 'empty'
          ? `<p class="fr-hint-text">${esc(s.places.message)}</p>`
          : s.places.data
            ? `<ul class="da-results" aria-label="Communes proposées">${s.places.data
                .map((p, i) => `<li><button type="button" class="da-result" data-act="pick-place" data-i="${i}"><span class="da-result-title">${esc(p.label)}</span><span class="da-result-meta">${esc(p.context ?? '')}</span></button></li>`)
                .join('')}</ul>`
            : ''
  const drawingMsg = drawing
    ? `<div class="fr-alert fr-alert--info fr-alert--sm" role="status"><p>${drawing === 'rectangle' ? 'Cliquez-glissez sur la carte pour tracer le rectangle.' : 'Cliquez pour poser les sommets, double-cliquez pour terminer.'} Sans souris : « Emprise actuelle » ou coordonnées.</p>
        <button type="button" class="fr-btn fr-btn--sm fr-btn--secondary" data-act="cancel-draw">Annuler le tracé</button></div>`
    : ''
  const method = (act: string, label: string, icon: string, pressed?: boolean) =>
    `<button type="button" class="da-method" data-act="${act}" ${pressed !== undefined ? `aria-pressed="${pressed}"` : ''}><span class="${icon}" aria-hidden="true"></span>${label}</button>`
  return `<div class="da-methods">
      ${method('use-viewport', 'Emprise actuelle<br><small>de la carte</small>', 'fr-icon-fullscreen-line')}
      ${method('draw-rect', 'Dessiner<br><small>un rectangle</small>', 'fr-icon-edit-box-line', drawing === 'rectangle')}
      ${method('draw-poly', 'Dessiner<br><small>un polygone</small>', 'fr-icon-edit-line', drawing === 'polygon')}
    </div>
    ${drawingMsg}
    <div class="fr-input-group da-place-search"><label class="fr-label" for="da-place-input">… ou rechercher une commune</label>
      <input class="fr-input" type="search" id="da-place-input" autocomplete="off" placeholder="Vincennes, Lyon…" /></div>
    <div aria-live="polite">${places}${s.areaMessage ? alertHtml('warning', s.areaMessage) : ''}</div>
    <details class="da-details"><summary>Saisir des coordonnées (WGS84)</summary>
      <form id="da-bbox-form" class="da-bbox-form" novalidate>
        <p class="fr-hint-text">Degrés décimaux (ex. 2,41 ; 48,83).</p>
        ${[['ouest', 'Longitude ouest'], ['sud', 'Latitude sud'], ['est', 'Longitude est'], ['nord', 'Latitude nord']]
          .map(([n, l]) => `<div class="fr-input-group"><label class="fr-label" for="da-bbox-${n}">${l}</label><input class="fr-input" id="da-bbox-${n}" name="${n}" inputmode="decimal" autocomplete="off" /></div>`)
          .join('')}
        <button class="fr-btn fr-btn--sm" type="submit">Appliquer</button>
        <div id="da-bbox-error" aria-live="polite"></div>
      </form></details>`
}

/**
 * La zone n'est jamais une étape obligatoire : elle sert à vérifier qu'un service
 * couvre le secteur, ou à télécharger / extraire. Elle se définit ici, quand on en a besoin.
 */
export function renderZoneBox(s: AppState): string {
  const a = s.area
  const open = s.zoneOpen || !!s.drawing
  if (!a && !open) {
    return `<section class="da-zonebox" aria-labelledby="da-zone-h"><h3 id="da-zone-h" class="fr-h6">Ma zone <span class="da-opt">(facultatif)</span></h3>
      <p class="fr-text--sm">Utile pour vérifier qu’un service couvre votre secteur, ou pour télécharger / extraire seulement ce qui vous concerne.</p>
      <button type="button" class="fr-btn fr-btn--secondary fr-btn--sm" data-act="open-zone">Définir une zone</button></section>`
  }
  const admin =
    s.adminZones.status === 'loading'
      ? loadingHtml('Recherche des territoires concernés…')
      : s.adminZones.status === 'error'
        ? alertHtml('error', 'Territoires indisponibles', s.adminZones.message)
        : s.adminZones.status === 'empty'
          ? alertHtml('warning', 'Hors couverture', s.adminZones.message)
          : s.adminZones.data
            ? `<p class="fr-hint-text">Territoires concernés : ${esc(s.adminZones.data.filter((z) => z.level === 'departement').map((z) => z.name).join(', '))}.</p>`
            : ''
  const summary = a
    ? `<div class="da-zone-summary" role="group" aria-label="Zone sélectionnée">
        <p><strong>${esc(a.label)}</strong> — ${esc(formatArea(a.areaSqm))}</p>
        <p class="fr-text--sm">${esc(formatBBox(a.bbox))}</p>${admin}${renderCoverage(s)}
        <div class="da-nav-right"><button type="button" class="fr-btn fr-btn--tertiary fr-btn--sm" data-act="${open ? 'close-zone' : 'open-zone'}">${open ? 'Masquer les outils' : 'Modifier la zone'}</button>
        <button type="button" class="fr-btn fr-btn--tertiary fr-btn--sm fr-icon-delete-line fr-btn--icon-left" data-act="clear-area">Supprimer la zone</button></div></div>`
    : ''
  return `<section class="da-zonebox" aria-labelledby="da-zone-h"><h3 id="da-zone-h" class="fr-h6">Ma zone <span class="da-opt">(facultatif)</span></h3>
    ${a && !open ? '' : zoneTools(s)}
    ${summary}
    ${!a ? '<div class="da-nav"><button type="button" class="fr-btn fr-btn--tertiary fr-btn--sm" data-act="close-zone">Fermer</button></div>' : ''}
  </section>`
}

/* -------------------------------------------------------------------- étape 3 */

function tabButton(s: AppState, id: AppState['tab'], label: string, disabledReason?: string): string {
  const selected = s.tab === id
  return `<button type="button" role="tab" class="da-tab" id="da-tab-${id}" aria-selected="${selected}" aria-controls="da-panel-${id}" tabindex="${selected ? 0 : -1}"
    data-act="tab" data-tab="${id}" ${disabledReason ? `title="${esc(disabledReason)}"` : ''}>${label}</button>`
}

function zoneNeeded(why: string): string {
  return `${alertHtml('info', 'Zone nécessaire', why)}<div class="da-nav"><button type="button" class="fr-btn" data-act="open-zone">Définir une zone</button></div>`
}

function renderTabDownload(s: AppState): string {
  const d = s.dataset!
  if (d.downloads.length > 0 && !s.area) return zoneNeeded('Les fichiers sont proposés par territoire : choisissez d’abord une zone. (Les services WMS, WMTS, TMS… s’utilisent sans zone : voir « Utiliser dans un SIG ».)')
  if (d.downloads.length === 0) {
    return alertHtml('info', 'Pas de téléchargement pour cette donnée', 'Elle peut être consultée sur la carte, utilisée dans un SIG si un service existe, ou extraite sur votre zone si vous êtes connecté.')
  }
  const dl = s.download
  if (dl.status === 'loading' || dl.status === 'idle') return loadingHtml('Recherche des fichiers de la zone…')
  if (dl.status === 'error') return alertHtml('error', 'Fichiers indisponibles', dl.message)
  const data = dl.data
  if (!data || dl.status === 'empty') return alertHtml('warning', 'Aucun fichier', dl.message)

  const dateSelect =
    data.availableDates.length > 1
      ? `<div class="fr-select-group"><label class="fr-label" for="da-date">Version</label>
          <select class="fr-select" id="da-date"><option value="">Dernière version disponible</option>
          ${data.availableDates.map((x) => `<option value="${esc(x)}"${x === s.date ? ' selected' : ''}>${esc(formatDate(x))}</option>`).join('')}</select></div>`
      : `<p class="fr-text--sm">Version : <strong>${esc(formatDate(data.edition) ?? 'non datée')}</strong> (seule disponible).</p>`
  const formatSelect =
    data.availableFormats.length > 1
      ? `<div class="fr-select-group"><label class="fr-label" for="da-format">Format</label>
          <select class="fr-select" id="da-format">${data.availableFormats.map((f) => `<option value="${esc(f.code)}"${f.code === data.format ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}</select></div>`
      : ''
  const resourceSelect =
    d.downloads.length > 1
      ? `<div class="fr-select-group"><label class="fr-label" for="da-resource">Variante du produit</label>
          <select class="fr-select" id="da-resource">${d.downloads.map((r) => `<option value="${esc(r.id)}"${r.id === (s.resourceId ?? d.downloads[0].id) ? ' selected' : ''}>${esc(r.title)}</option>`).join('')}</select></div>`
      : ''
  const rows = data.files
    .map(
      (f) => `<tr><td>${esc(f.zoneLabel)}</td><td class="da-file"><a href="${esc(f.url)}" download rel="noopener">${esc(f.fileName)}</a></td>
        <td>${f.sizeBytes !== undefined ? esc(formatBytes(f.sizeBytes)) : 'inconnue'}</td></tr>`,
    )
    .join('')
  return `${dl.status === 'partial' ? alertHtml('warning', 'Couverture partielle', dl.message) : ''}
    <div class="da-big-number" role="status"><strong>${data.files.length}</strong> fichier${data.files.length > 1 ? 's' : ''}
      ${data.totalBytes !== undefined ? ` · <strong>${esc(formatBytes(data.totalBytes))}</strong>` : ' · volume non communiqué'}</div>
    ${dateSelect}
    <div class="fr-table fr-table--no-caption da-table"><table><caption>Fichiers à télécharger</caption>
      <thead><tr><th scope="col">Territoire</th><th scope="col">Fichier</th><th scope="col">Taille</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="fr-text--sm">Ces fichiers couvrent des territoires entiers : ils contiennent votre zone et au-delà. Pour ne récupérer que votre zone, utilisez l’onglet « Extraire ».</p>
    <div class="da-nav"><button type="button" class="fr-btn fr-icon-download-line fr-btn--icon-left" data-act="download-first">Télécharger${data.files.length > 1 ? ' le premier fichier' : ''}</button>
      <button type="button" class="fr-btn fr-btn--secondary fr-btn--sm" data-act="copy-links">Copier les liens</button></div>
    <details class="da-details"><summary>Options avancées</summary>${resourceSelect}${formatSelect}
      ${data.crs.length ? `<p class="fr-text--sm">Systèmes de coordonnées publiés pour ce produit : ${esc(data.crs.join(', '))}. Le service de téléchargement ne permet pas d’en choisir un : les fichiers sont fournis tels que publiés.</p>` : ''}
      <h4 class="fr-h6">Accès techniques</h4>${renderAccessList(d)}</details>`
}

function renderAccessList(d: Dataset): string {
  const open = d.services.filter((x) => !x.restricted)
  if (!open.length) return '<p class="fr-text--sm">Aucun accès ouvert.</p>'
  return `<ul class="da-access-list">${open
    .slice(0, 12)
    .map((x) => `<li><span class="fr-badge fr-badge--sm">${x.kind}</span> <code>${esc(x.layer)}</code> <button type="button" class="fr-btn fr-btn--tertiary-no-outline fr-btn--sm" data-act="copy-service" data-i="${d.services.indexOf(x)}">Copier l’URL</button></li>`)
    .join('')}</ul>${open.length > 12 ? `<p class="fr-hint-text">${open.length - 12} autres accès non listés ici.</p>` : ''}`
}

function renderTabGis(s: AppState): string {
  const d = s.dataset!
  const o = gisIntegration.getOptions({ resource: d, availableServices: d.services, selectedArea: s.area, selectedLayer: s.layer })
  if (!o.clients.length) {
    return restrictedNotice(d) || alertHtml('warning', 'Aucun accès exploitable', 'Cette donnée n’a pas de service WMS, WMTS ou WFS ouvert.')
  }
  const la = o.layers.find((l) => l.layer === o.selectedLayer)
  const r = s.gis.result
  const result = r
    ? r.kind === 'loading'
      ? loadingHtml(r.title)
      : alertHtml(r.kind, r.title, r.text) + (r.code ? `<pre class="da-code" tabindex="0">${esc(r.code)}</pre>` : '')
    : ''
  return `${s.area ? renderCoverage(s) : '<p class="fr-hint-text">Aucune zone nécessaire pour utiliser un géoservice. Définissez-en une plus bas pour vérifier qu’il couvre votre secteur.</p>'}
    ${la ? `<p class="fr-text--sm">Mode choisi automatiquement : <strong>${la.recommended.kind}</strong>. ${esc(la.reason)}</p>` : ''}
    ${o.layers.length > 1 ? `<details class="da-details"${o.layers.length < 6 ? ' open' : ''}><summary>Choisir une autre couche (${o.layers.length} disponibles)</summary>
      <div class="fr-select-group"><label class="fr-label" for="da-gis-layer">Couche à utiliser</label>
      <select class="fr-select" id="da-gis-layer">${o.layers.map((l) => `<option value="${esc(l.layer)}"${l.layer === o.selectedLayer ? ' selected' : ''}>${esc(l.layer)}</option>`).join('')}</select></div></details>` : ''}
    ${o.clients
      .map(
        (c) => `<section class="da-client" aria-label="${esc(c.label)}"><h4 class="fr-h6">${esc(c.label)}</h4>
          <ul class="da-actions-list">${c.actions.map((a) => `<li><button type="button" class="fr-btn fr-btn--secondary fr-btn--sm" data-act="gis-run" data-gis="${esc(c.id)}:${esc(a.id)}">${esc(a.label)}</button><span class="fr-hint-text">${esc(a.description)}</span></li>`).join('')}</ul>
          <details class="da-details"><summary>Comment l’utiliser ?</summary><ol>${c.instructions.map((i) => `<li>${esc(i)}</li>`).join('')}</ol></details></section>`,
      )
      .join('')}
    <div aria-live="polite">${result}</div>
    <p class="fr-text--sm">QGIS n’offre pas de lien d’ouverture automatique depuis un navigateur : le fichier téléchargé s’ouvre d’un double-clic ou par glisser-déposer.</p>`
}

function renderTabExtract(s: AppState): string {
  const d = s.dataset!
  const x = s.extraction
  const intro = `<p class="fr-text--sm">L’extraction <strong>découpe les tables vecteur du produit à votre zone</strong> et prépare un fichier unique. Elle exige un compte Géoplateforme, ne traite qu’un job à la fois et prend plusieurs minutes.</p>`
  if (!s.area) return `${intro}${zoneNeeded('L’extraction découpe les données à votre zone : choisissez-la d’abord.')}`
  if (!auth.authenticated) {
    return `${intro}${alertHtml('info', 'Connexion requise', 'Connectez-vous pour accéder aux produits d’extraction de votre compte.')}
      <div class="da-nav"><button type="button" class="fr-btn" data-act="login">Se connecter</button></div>`
  }
  let body = ''
  const p = x.processes
  if (p.status === 'loading') return `${intro}${loadingHtml('Chargement de vos produits d’extraction…')}`
  if (p.status === 'error') return `${intro}${alertHtml('error', 'Produits indisponibles', p.message)}<button type="button" class="fr-btn fr-btn--sm" data-act="extract-reload">Réessayer</button>`
  if (p.status === 'empty') return `${intro}${alertHtml('warning', 'Aucun produit', p.message)}`
  if (p.status !== 'ready' || !p.data) return `${intro}${loadingHtml('Préparation…')}`

  const best = p.data[0]
  body += `<div class="fr-select-group"><label class="fr-label" for="da-process">Produit d’extraction
      <span class="fr-hint-text">Le rapprochement avec « ${esc(d.title)} » est une proposition (mots communs) : vérifiez-le.</span></label>
    <select class="fr-select" id="da-process"><option value="">— Choisir —</option>
      ${p.data.map((m) => `<option value="${esc(m.process.id)}"${m.process.id === x.processId ? ' selected' : ''}>${esc(m.process.title)}${m === best && m.score >= 0.5 ? ' (proposé)' : ''}</option>`).join('')}</select></div>`

  const det = x.details
  if (det.status === 'loading') body += loadingHtml('Lecture du produit…')
  else if (det.status === 'error') body += alertHtml('error', 'Produit illisible', det.message)
  else if (det.status === 'ready' && det.data) {
    const { process, stored } = det.data
    const fields = editableFields(process)
    const fieldHtml = fields
      .map((f) => {
        const options = fieldEnum(f)
        if (options) {
          return `<div class="fr-select-group"><label class="fr-label" for="da-f-${esc(f.id)}">${esc(f.title)}</label>
            <select class="fr-select" id="da-f-${esc(f.id)}" data-act-change="field" data-field="${esc(f.id)}">${options.map((o) => `<option value="${esc(o)}"${String(x.values[f.id]) === String(o) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`
        }
        return fieldType(f) === 'boolean'
          ? `<div class="fr-checkbox-group"><input type="checkbox" id="da-f-${esc(f.id)}" data-act-change="field-bool" data-field="${esc(f.id)}" ${x.values[f.id] ? 'checked' : ''}><label class="fr-label" for="da-f-${esc(f.id)}">${esc(f.title)}</label></div>`
          : ''
      })
      .join('')
    body += `<fieldset class="da-tables"><legend class="fr-label">Tables à extraire (${x.selectedTables.length}/${stored.tables.length})</legend>
        <div class="da-nav"><button type="button" class="fr-btn fr-btn--tertiary-no-outline fr-btn--sm" data-act="tables-all">Tout cocher</button>
          <button type="button" class="fr-btn fr-btn--tertiary-no-outline fr-btn--sm" data-act="tables-none">Tout décocher</button></div>
        <div class="da-tables-list">${stored.tables
          .map((t) => `<div class="fr-checkbox-group fr-checkbox-group--sm"><input type="checkbox" id="da-t-${esc(t.name)}" data-act-change="table" data-table="${esc(t.name)}" ${x.selectedTables.includes(t.name) ? 'checked' : ''}><label class="fr-label" for="da-t-${esc(t.name)}">${esc(t.name)}</label></div>`)
          .join('')}</div></fieldset>${fieldHtml}`
    if (!s.area) body += alertHtml('info', 'Zone manquante', 'Choisissez une zone pour lancer l’extraction.')
  }

  const job = x.job
  let jobHtml = ''
  if (job) {
    const kind = isSuccessful(job.status) ? 'success' : isFailed(job.status) ? 'error' : 'info'
    jobHtml += alertHtml(kind, `Job ${job.status}`, job.message || (isRunning(job.status) ? 'Extraction en cours : l’état est relevé toutes les 15 secondes. Gardez cette page ouverte.' : undefined))
    if (isRunning(job.status)) jobHtml += `<p class="da-loading" role="status"><span class="da-spinner" aria-hidden="true"></span>En cours…</p>
      <button type="button" class="fr-btn fr-btn--tertiary fr-btn--sm" data-act="extract-cancel">Annuler le job</button>`
  }
  if (x.files) {
    jobHtml += x.files.length
      ? `<ul class="da-access-list">${x.files.map((f) => `<li><a href="${esc(f.href)}" download rel="noopener">${esc(f.filename)}</a>${f.isMetadata ? ' <span class="fr-badge fr-badge--sm">métadonnées</span>' : ''}</li>`).join('')}</ul>`
      : alertHtml('warning', 'Aucun fichier', 'Le job est terminé mais ne fournit aucun fichier.')
  }
  if (x.logs) jobHtml += `<details class="da-details"><summary>Journal du service</summary><pre class="da-code">${esc(x.logs)}</pre></details>`
  if (x.error) {
    jobHtml += alertHtml('error', 'Extraction impossible', x.error.message)
    if (x.error.report) jobHtml += `<button type="button" class="fr-btn fr-btn--tertiary fr-btn--sm" data-act="copy-report">Copier le rapport d’erreur</button>`
  }
  const plan = x.plan?.extent
    ? `<p class="fr-hint-text" role="status">Contour envoyé : ${plan2text(x.plan.extent.mode, x.plan.extent.toleranceM)} · requête de ${formatBytes(x.plan.bodyBytes)}.</p>`
    : ''
  const canLaunch = !!s.area && det.status === 'ready' && x.selectedTables.length > 0 && !x.launching && !(job && isRunning(job.status))
  return `${intro}${body}${plan}<div class="da-nav"><button type="button" class="fr-btn" data-act="extract-launch" ${canLaunch ? '' : 'disabled'}>${x.launching ? 'Envoi…' : 'Lancer l’extraction'}</button></div>${jobHtml}`
}

function plan2text(mode: string, tolerance?: number): string {
  return mode === 'precise' ? 'contour précis' : mode === 'simplified' ? `contour simplifié (±${tolerance} m, élargi de cette valeur)` : 'rectangle englobant (le contour dépassait le budget de taille)'
}

export function renderTabs(s: AppState): string {
  const d = s.dataset!
  const noDownload = d.downloads.length === 0 ? 'Pas de fichier à télécharger pour cette donnée' : undefined
  const noGis = !hasGeoservices(d) ? 'Pas de service WMS, WMTS, WFS ou TMS ouvert' : undefined
  const panels: Record<AppState['tab'], () => string> = {
    download: () => renderTabDownload(s),
    gis: () => renderTabGis(s),
    extract: () => renderTabExtract(s),
  }
  return `<div class="da-tabs" role="tablist" aria-label="Mode de récupération">
      ${tabButton(s, 'gis', 'Utiliser dans un SIG', noGis)}${tabButton(s, 'download', 'Télécharger', noDownload)}${tabButton(s, 'extract', 'Extraire')}
    </div>
    <div role="tabpanel" id="da-panel-${s.tab}" aria-labelledby="da-tab-${s.tab}" tabindex="0" class="da-tabpanel">${panels[s.tab]()}</div>`
}

export { defaultLayer }
