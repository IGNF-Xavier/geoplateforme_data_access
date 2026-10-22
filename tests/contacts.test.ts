import { describe, expect, it } from 'vitest'
import { cleanEmail, mailtoLink, parseContacts, parseRecord } from '../src/api/catalogue'
import { groupDocuments } from '../src/api/searchIndex'
import { renderContacts } from '../src/components/views'
import { BDTOPO_RECORD } from './fixtures'

/** FIXTURES DE TEST : contact tel que publié par le catalogue (forme réelle, adresse fictive pour les cas limites). */
const IGN_CONTACT = {
  role: 'pointOfContact',
  address: 'IGN - Support utilisateurs, 73 avenue de Paris, SAINT-MANDÉ CÉDEX, 94165, FRANCE',
  organisationObject: { default: "INSTITUT NATIONAL DE L'INFORMATION GEOGRAPHIQUE ET FORESTIERE (IGN)" },
  email: 'contact.geoservices@ign.fr',
  website: '',
}

describe('adresse courriel du producteur', () => {
  it('valide une seule adresse plausible et rejette le reste', () => {
    expect(cleanEmail(' contact.geoservices@ign.fr ')).toBe('contact.geoservices@ign.fr')
    for (const bad of [undefined, '', 'pas-une-adresse', 'a@b', 'a@b.c', 'x@y.fr, z@y.fr', 'x@y.fr;z@y.fr', 'x y@z.fr', '<x@y.fr>', 'x@y.fr\nBcc: z@y.fr', `${'a'.repeat(250)}@b.fr`]) {
      expect(cleanEmail(bad), String(bad)).toBeUndefined()
    }
  })

  it('construit un lien mailto avec objet encodé, jamais depuis une adresse invalide', () => {
    expect(mailtoLink('contact.geoservices@ign.fr', 'Demande : BD TOPO® & co')).toBe('mailto:contact.geoservices@ign.fr?subject=Demande%20%3A%20BD%20TOPO%C2%AE%20%26%20co')
    expect(mailtoLink('x@y.fr?bcc=evil@z.fr', 's')).toBeUndefined()
    expect(mailtoLink(undefined, 's')).toBeUndefined()
  })
})

describe('contacts du catalogue', () => {
  it('lit organisation, courriel, rôle et adresse de la fiche', () => {
    const c = parseContacts({ uuid: 'x', contactForResource: [IGN_CONTACT] })
    expect(c).toEqual([
      { organisation: "INSTITUT NATIONAL DE L'INFORMATION GEOGRAPHIQUE ET FORESTIERE (IGN)", email: 'contact.geoservices@ign.fr', website: undefined, role: 'pointOfContact', address: IGN_CONTACT.address },
    ])
  })

  it('dédoublonne, écarte les contacts vides, les courriels invalides et les sites non http(s)', () => {
    const c = parseContacts({
      uuid: 'x',
      contactForResource: [
        IGN_CONTACT,
        { ...IGN_CONTACT, role: 'owner' },
        {},
        { organisationObject: { default: 'Mairie' }, email: 'pas-une-adresse', website: 'javascript:alert(1)' },
        { organisationObject: { default: 'Autre' }, website: 'https://exemple.fr/contact' },
      ],
    })
    expect(c.map((x) => x.organisation)).toEqual(["INSTITUT NATIONAL DE L'INFORMATION GEOGRAPHIQUE ET FORESTIERE (IGN)", 'Mairie', 'Autre'])
    expect(c[1].email).toBeUndefined()
    expect(c[1].website).toBeUndefined()
    expect(c[2].website).toBe('https://exemple.fr/contact')
  })

  it('une fiche sans contact donne une liste vide', () => {
    expect(parseRecord(BDTOPO_RECORD).contacts).toEqual([])
  })
})

describe('contacts de l’index de recherche', () => {
  const doc = (attribution?: object) => ({ id: 'd', layer_name: 'l', title: 'Couche', type: 'WFS', url: 'https://data.geopf.fr/wfs?x=1', open: false, attribution })

  it('reprend l’attribution ; le courriel n’existe que s’il est publié', () => {
    const [d] = groupDocuments([doc({ title: 'Ville de Lyon', url: 'https://www.lyon.fr', email: 'sig@lyon.fr' })])
    expect(d.contacts).toEqual([{ organisation: 'Ville de Lyon', email: 'sig@lyon.fr', website: 'https://www.lyon.fr' }])
    const [d2] = groupDocuments([doc({ title: 'IGN', url: 'http://www.ign.fr' })])
    expect(d2.contacts?.[0].email).toBeUndefined()
    expect(groupDocuments([doc()])[0].contacts).toEqual([])
  })
})

describe('affichage du contact', () => {
  const base = parseRecord(BDTOPO_RECORD)

  it('affiche l’adresse en lien mailto, avec copie, quand elle est publiée', () => {
    const html = renderContacts({ ...base, contacts: parseContacts({ uuid: 'x', contactForResource: [IGN_CONTACT] }) })
    expect(html).toContain('href="mailto:contact.geoservices@ign.fr?subject=')
    expect(html).toContain('data-act="copy-email"')
    expect(html).toContain('contact.geoservices@ign.fr</a>')
    expect(html).not.toContain('Aucune adresse')
  })

  it('dit honnêtement qu’aucune adresse n’est publiée, sans en inventer', () => {
    const html = renderContacts({ ...base, contacts: [{ organisation: 'IGN', website: 'https://www.ign.fr' }] })
    expect(html).toContain('Aucune adresse courriel n’est renseignée')
    expect(html).not.toContain('mailto:')
    expect(html).toContain('>Site<')
    expect(renderContacts({ ...base, contacts: [] })).toContain('Aucun contact n’est renseigné')
  })

  it('échappe le HTML venant des métadonnées', () => {
    const html = renderContacts({ ...base, contacts: [{ organisation: '<img src=x onerror=alert(1)>', website: 'https://e.fr/"><script>' }] })
    expect(html).not.toContain('<img')
    expect(html).not.toContain('"><script>')
  })
})
