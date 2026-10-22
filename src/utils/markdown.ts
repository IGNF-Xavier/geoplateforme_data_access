/**
 * Les métadonnées (catalogue, index) contiennent parfois du Markdown (« **gras** », listes,
 * liens). Deux usages, sans jamais injecter de HTML brut venant des métadonnées :
 *  - `stripMarkdown` : texte brut, pour les titres, résumés courts et libellés ;
 *  - `renderMarkdown` : HTML restreint (gras, italique, code, listes, liens http/https),
 *    construit APRÈS échappement du texte source.
 */

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Texte brut : retire les marques Markdown courantes et normalise les espaces. */
export function stripMarkdown(text?: string): string {
  if (!text) return ''
  return text
    .replace(/\r/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // liens et images → texte
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // titres
    .replace(/^\s*[-*•]\s+/gm, '• ') // puces
    .replace(/(\*\*|__)(.+?)\1/gs, '$2') // gras
    .replace(/(^|[\s(])[*_]([^*_\n]+?)[*_](?=[\s).,;:!?]|$)/g, '$1$2') // italique
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Texte brut sur une seule ligne (titres, libellés). */
export const plainText = (text?: string): string => stripMarkdown(text).replace(/\s*\n\s*/g, ' ')

function inline(escaped: string): string {
  return escaped
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`)
    .replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>')
    .replace(/(^|[\s(])[*_]([^*_\n]+?)[*_](?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

/** HTML restreint à partir de Markdown : paragraphes, listes à puces, gras, italique, code, liens http(s). */
export function renderMarkdown(text?: string): string {
  if (!text) return ''
  const blocks = text.replace(/\r/g, '').trim().split(/\n{2,}/)
  return blocks
    .map((block) => {
      const lines = block.split('\n')
      if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(escapeHtml(l.replace(/^\s*[-*•]\s+/, '')))}</li>`).join('')}</ul>`
      }
      const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(block)
      if (heading) return `<p><strong>${inline(escapeHtml(heading[1]))}</strong></p>`
      return `<p>${lines.map((l) => inline(escapeHtml(l.trim()))).join('<br>')}</p>`
    })
    .join('')
}
