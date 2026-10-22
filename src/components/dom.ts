export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function $(selector: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector)
  if (!el) throw new Error(`Élément introuvable : ${selector}`)
  return el
}

export function alertHtml(kind: 'error' | 'info' | 'warning' | 'success', title: string, text?: string): string {
  return `<div class="fr-alert fr-alert--${kind} fr-alert--sm" role="${kind === 'error' ? 'alert' : 'status'}">
    <p class="fr-alert__title">${esc(title)}</p>${text ? `<p>${esc(text)}</p>` : ''}</div>`
}

export function loadingHtml(label: string): string {
  return `<p class="da-loading" role="status"><span class="da-spinner" aria-hidden="true"></span>${esc(label)}</p>`
}

export function formatDate(iso?: string): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Télécharge un contenu texte généré localement (fichier de configuration SIG). */
export function saveTextFile(fileName: string, mimeType: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}
