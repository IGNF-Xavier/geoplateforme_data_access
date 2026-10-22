/**
 * Mise en forme des textes issus des métadonnées, pour l'affichage uniquement.
 */

const SMALL_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'au', 'aux', 'd', 'l'])

/**
 * Producteur lisible : « INSTITUT NATIONAL DE L'INFORMATION GEOGRAPHIQUE ET FORESTIERE (IGN) »
 * devient « IGN » ; un nom tout en majuscules sans sigle est mis en casse de titre.
 */
export function shortProducer(name?: string): string | undefined {
  const text = name?.replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  const acronym = /\(([A-Za-z0-9ÉÈÀ-]{2,12})\)\s*$/.exec(text)?.[1]
  if (acronym) return acronym
  if (text !== text.toUpperCase() || text.length <= 5) return text
  return text
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w.replace(/['’]$/, '')) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/** Coupe un texte à `max` caractères, à une frontière de mot, avec une ellipse. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).trim()}…`
}
