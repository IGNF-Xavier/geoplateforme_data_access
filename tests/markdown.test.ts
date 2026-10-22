import { describe, expect, it } from 'vitest'
import { parseRecord } from '../src/api/catalogue'
import { groupDocuments } from '../src/api/searchIndex'
import { plainText, renderMarkdown, stripMarkdown } from '../src/utils/markdown'

describe('stripMarkdown / plainText', () => {
  it('retire le gras, l’italique, le code, les titres et les liens', () => {
    expect(stripMarkdown('**Couche des éléments à reprendre sur la BD TOPO, depuis la Métropole de Lyon**')).toBe('Couche des éléments à reprendre sur la BD TOPO, depuis la Métropole de Lyon')
    expect(stripMarkdown('__gras__ et *italique* et _autre_ et `code`')).toBe('gras et italique et autre et code')
    expect(stripMarkdown('# Titre\nTexte')).toBe('Titre\nTexte')
    expect(stripMarkdown('Voir [le site](https://exemple.fr/a?b=1) ici')).toBe('Voir le site ici')
    expect(stripMarkdown('- un\n- deux')).toBe('• un\n• deux')
  })

  it('ne touche pas aux astérisques et soulignés internes aux mots ni aux identifiants', () => {
    expect(stripMarkdown('couche_sans_style et 2*3')).toBe('couche_sans_style et 2*3')
    expect(stripMarkdown('BDTOPO_V3:batiment')).toBe('BDTOPO_V3:batiment')
  })

  it('plainText tient sur une ligne', () => {
    expect(plainText('**Titre**\n\nsuite')).toBe('Titre suite')
    expect(plainText(undefined)).toBe('')
  })
})

describe('renderMarkdown', () => {
  it('produit gras, italique, code, listes et paragraphes', () => {
    expect(renderMarkdown('**Gras** et *italique* et `code`')).toBe('<p><strong>Gras</strong> et <em>italique</em> et <code>code</code></p>')
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>')
    expect(renderMarkdown('un\n\ndeux')).toBe('<p>un</p><p>deux</p>')
    expect(renderMarkdown('ligne 1\nligne 2')).toBe('<p>ligne 1<br>ligne 2</p>')
    expect(renderMarkdown('## Titre')).toBe('<p><strong>Titre</strong></p>')
  })

  it('autorise seulement les liens http(s)', () => {
    expect(renderMarkdown('[ok](https://exemple.fr/x?a=1&b=2)')).toContain('<a href="https://exemple.fr/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">ok</a>')
    expect(renderMarkdown('[mal](javascript:alert(1))')).not.toContain('<a')
    expect(renderMarkdown('[mal](data:text/html,x)')).not.toContain('<a')
  })

  it('échappe tout HTML venant des métadonnées', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> **x** <script>alert(1)</script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;img')
    expect(html).toContain('<strong>x</strong>')
    expect(renderMarkdown('[a"onmouseover="x](https://e.fr)')).not.toContain('onmouseover="x"')
  })

  it('texte vide', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown(undefined)).toBe('')
  })
})

describe('application aux métadonnées', () => {
  it('le titre, le producteur et la licence du catalogue sont nettoyés ; le résumé garde son Markdown', () => {
    const d = parseRecord({
      uuid: 'x',
      resourceTitleObject: { default: '**Reprise** sur la BD TOPO' },
      OrgForResourceObject: { default: '*Métropole de Lyon*' },
      licenseObject: [{ default: '**Licence ouverte**' }],
      resourceAbstractObject: { default: '**Couche des éléments**' },
    })
    expect(d.title).toBe('Reprise sur la BD TOPO')
    expect(d.producer).toBe('Métropole de Lyon')
    expect(d.license).toBe('Licence ouverte')
    expect(d.abstract).toBe('**Couche des éléments**')
  })

  it('l’index : titre et producteur nettoyés', () => {
    const [d] = groupDocuments([{ id: 'd', layer_name: 'l', title: '**Couche** test', type: 'WFS', url: 'https://data.geopf.fr/wfs?x=1', open: true, producers: ['**IGN**'] }])
    expect(d.title).toBe('Couche test')
    expect(d.producer).toBe('IGN')
  })
})
