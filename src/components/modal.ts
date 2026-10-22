import { esc } from './dom'

let counter = 0

/**
 * Fenêtre modale DSFR (classes `fr-modal`) pilotée à la main : ouverture, piégeage
 * du focus, fermeture par Échap / bouton / clic sur le fond, restitution du focus.
 */
export function openModal(options: { title: string; body: string }): HTMLElement {
  const id = `da-modal-${counter++}`
  const previous = document.activeElement as HTMLElement | null
  const root = document.getElementById('da-modal-root')!
  root.innerHTML = `
    <div id="${id}" class="fr-modal da-modal da-open" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
      <div class="fr-container fr-container--fluid fr-container-md">
        <div class="fr-grid-row fr-grid-row--center">
          <div class="fr-col-12 fr-col-md-10 fr-col-lg-8">
            <div class="fr-modal__body">
              <div class="fr-modal__header">
                <button type="button" class="fr-btn--close fr-btn" data-close>Fermer</button>
              </div>
              <div class="fr-modal__content">
                <h2 id="${id}-title" class="fr-modal__title">${esc(options.title)}</h2>
                ${options.body}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`
  const modal = document.getElementById(id)!
  const close = () => {
    root.innerHTML = ''
    document.removeEventListener('keydown', onKey)
    previous?.focus()
  }
  const focusables = () =>
    [...modal.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select, input, summary, [tabindex="0"]')]
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return close()
    if (e.key !== 'Tab') return
    const f = focusables()
    if (!f.length) return
    const first = f[0]
    const last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
  document.addEventListener('keydown', onKey)
  modal.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (t === modal || t.closest('[data-close]')) close()
  })
  modal.querySelector<HTMLElement>('[data-close]')!.focus()
  return modal
}
