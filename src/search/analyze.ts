/**
 * Analyse d'une requête en langage courant : normalisation (accents, casse, pluriels),
 * retrait des mots d'amorce (« je cherche les… »), et reconnaissance tolérante aux fautes
 * de frappe des besoins du thésaurus.
 */
import { CONCEPTS, type Concept } from './thesaurus'

export const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Mots d'amorce ou de liaison sans valeur pour la recherche. */
const STOP = new Set(
  ('je j tu il on nous vous cherche chercher recherche rechercher veux voudrais voulais souhaite besoin avoir trouver trouve donnee donnees data jeu jeux ' +
    'les le la l des de du d un une et ou en sur pour dans a au aux mon ma mes ce cette ces qui que quoi est sont y ici avec par ' +
    'france francais francaise zone commune ma sur tout toute tous toutes').split(' '),
)
export function singular(word: string): string {
  if (word.length <= 3) return word
  if (word.endsWith('eaux')) return word.slice(0, -1)
  if (word.endsWith('aux')) return `${word.slice(0, -3)}al`
  return /[sx]$/.test(word) ? word.slice(0, -1) : word
}

/** Distance d'édition ≤ 1 (insertion, suppression, substitution, transposition). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  const ra = a.slice(i)
  const rb = b.slice(i)
  if (ra.length === rb.length) {
    return ra.slice(1) === rb.slice(1) || (ra.length > 1 && ra[0] === rb[1] && ra[1] === rb[0] && ra.slice(2) === rb.slice(2))
  }
  return ra.length > rb.length ? ra.slice(1) === rb : rb.slice(1) === ra
}

export interface Analysis {
  raw: string
  /** Mots normalisés et au singulier, mots d'amorce retirés. */
  tokens: string[]
  /** `tokens` recomposés : la requête « utile ». */
  phrase: string
  concepts: Concept[]
}

const triggerTokens = (trigger: string) => fold(trigger).split(' ').map(singular)

function matches(concept: Concept, words: string[]): boolean {
  const padded = ` ${words.join(' ')} `
  return concept.triggers.some((t) => {
    const tt = triggerTokens(t)
    if (padded.includes(` ${tt.join(' ')} `)) return true
    // Tolérance aux fautes de frappe pour les mots simples assez longs (« batiements »).
    return tt.length === 1 && tt[0].length >= 6 && words.some((w) => w.length >= 6 && withinOneEdit(w, tt[0]))
  })
}

export function analyze(text: string): Analysis {
  const raw = fold(text).split(' ').filter(Boolean)
  const words = raw.map(singular)
  // Mot d'amorce reconnu avant ET après singularisation (« voudrais » → « voudrai »).
  const content = words.filter((w, i) => !STOP.has(w) && !STOP.has(raw[i]))
  // Si tout est retiré (ex. « commune » seul), on garde les mots tels quels.
  const effective = content.length ? content : words
  return {
    raw: text.trim(),
    tokens: effective,
    phrase: effective.join(' '),
    concepts: CONCEPTS.filter((c) => matches(c, words)),
  }
}
