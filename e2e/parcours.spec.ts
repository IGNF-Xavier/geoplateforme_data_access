import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

/** Les scénarios interrogent les VRAIES APIs de la Géoplateforme. */

async function search(page: Page, text: string) {
  await page.goto('/')
  await page.getByLabel(/Que cherchez-vous/).fill(text)
}

async function pickBdTopo(page: Page) {
  await search(page, 'BD TOPO')
  // Attendre que la liste soit celle de la recherche (la saisie déclenche une recherche différée).
  await expect(page.locator('.da-result').first()).toContainText('BD TOPO', { timeout: 30_000 })
  await page.getByRole('button', { name: /^BD TOPO®/ }).first().click()
  await expect(page.getByRole('heading', { name: 'BD TOPO®', level: 3 })).toBeVisible()
}

async function defineZoneFromCommune(page: Page, commune: string) {
  await page.getByRole('button', { name: 'Définir une zone' }).click()
  await page.getByLabel('… ou rechercher une commune').fill(commune)
  await page.getByRole('button', { name: new RegExp(commune) }).first().click()
  await expect(page.getByRole('group', { name: 'Zone sélectionnée' })).toContainText(commune)
}

test('recherche par besoin : « bâtiments » propose la BD TOPO sans en connaître le nom', async ({ page }) => {
  await search(page, 'bâtiments')
  await expect(page.locator('.da-understood')).toContainText('Bâtiments', { timeout: 30_000 })
  const first = page.locator('.da-result').first()
  await expect(first).toContainText('BD TOPO')
  await expect(first.locator('.da-result-why')).toContainText('Bâtiments')
})

test('recherche par besoin : puces de suggestion et fautes de frappe', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Photos aériennes/ }).click()
  await expect(page.locator('.da-result').first()).toContainText(/ORTHO/i, { timeout: 30_000 })
  await page.getByLabel(/Que cherchez-vous/).fill('batiements')
  await expect(page.locator('.da-understood')).toContainText('Bâtiments', { timeout: 30_000 })
})

test('géoservices : utilisables SANS aucune zone (fichier QGIS natif)', async ({ page }) => {
  await pickBdTopo(page)
  // L'onglet SIG est ouvert d'emblée, et la zone est présentée comme facultative.
  const panel = page.getByRole('tabpanel')
  await expect(panel).toContainText('Mode choisi automatiquement : WMTS')
  await expect(panel).toContainText('Aucune zone nécessaire')
  await expect(page.getByText('(facultatif)')).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: /Télécharger le fichier QGIS/ }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.qlr$/)
  const content = await readFile((await download.path())!, 'utf8')
  expect(content).toContain('<!DOCTYPE qgis-layer-definition>')
  expect(content).toContain('https://data.geopf.fr/wmts')

  await panel.getByRole('button', { name: /Copier la connexion QGIS/ }).click()
  await expect(panel.locator('.da-code')).toContainText('layers=')

  // Les onglets qui dépendent d'une zone l'expliquent et proposent de la définir
  await page.getByRole('tab', { name: 'Télécharger' }).click()
  await expect(page.getByRole('tabpanel')).toContainText('Zone nécessaire')
})

test('la zone sert à vérifier la couverture du géoservice', async ({ page }) => {
  await pickBdTopo(page)
  await defineZoneFromCommune(page, 'Vincennes')
  await expect(page.getByRole('group', { name: 'Zone sélectionnée' })).toContainText('Zone couverte', { timeout: 30_000 })

  // Une zone au Japon est hors de l'emprise annoncée
  await page.getByRole('button', { name: 'Modifier la zone' }).click()
  await page.getByText('Saisir des coordonnées (WGS84)').click()
  await page.getByLabel('Longitude ouest').fill('139')
  await page.getByLabel('Latitude sud').fill('35')
  await page.getByLabel('Longitude est').fill('140')
  await page.getByLabel('Latitude nord').fill('36')
  await page.getByRole('button', { name: 'Appliquer' }).click()
  await expect(page.getByRole('group', { name: 'Zone sélectionnée' })).toContainText('hors de l’emprise', { timeout: 30_000 })
})

test('zone facultative : télécharger les fichiers du territoire', async ({ page }) => {
  await pickBdTopo(page)
  await defineZoneFromCommune(page, 'Vincennes')
  await page.getByRole('tab', { name: 'Télécharger' }).click()
  const panel = page.getByRole('tabpanel')
  await expect(panel).toContainText(/\d+ fichiers?\s*·\s*\d+(,\d+)?\s?(Mo|Go)/, { timeout: 60_000 })
  await expect(panel.getByRole('link').first()).toHaveAttribute('href', /^https:\/\/data\.geopf\.fr\/telechargement\/download\/BDTOPO\//)

  await page.getByRole('button', { name: 'Supprimer la zone' }).click()
  await expect(page.getByRole('tabpanel')).toContainText('Zone nécessaire')
})

test('index de recherche : donnée absente du catalogue (Patrinat / MNHN)', async ({ page }) => {
  await search(page, 'espèces protégées')
  // La saisie déclenche une recherche différée : attendre sa fin avant de cliquer (la liste se redessine).
  await expect(page.getByText(/couches? de l’index de recherche/)).toBeVisible({ timeout: 30_000 })
  const result = page.getByRole('button', { name: /Patrinat/ }).first()
  await expect(result).toBeVisible({ timeout: 30_000 })
  await result.click()
  await expect(page.locator('.da-facts')).toContainText('Index de recherche Géoplateforme')
  await expect(page.getByRole('tabpanel')).toContainText(/WFS|WMS|WMTS/)
})

test('accès restreint signalé et non exploitable', async ({ page }) => {
  await search(page, 'orthophotographie infrarouge')
  const restricted = page.locator('.da-result', { hasText: 'Accès restreint' }).first()
  await expect(restricted).toBeVisible({ timeout: 30_000 })
  await restricted.click()
  await expect(page.getByText(/exigent des droits/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Télécharger le fichier QGIS/ })).toHaveCount(0)
})

test('connexion par jeton : extraction réservée, erreur du service expliquée', async ({ page }) => {
  await pickBdTopo(page)
  await page.getByRole('button', { name: 'Définir une zone' }).click()
  await page.getByRole('button', { name: /Emprise actuelle/ }).click()
  await page.getByRole('tab', { name: 'Extraire' }).click()
  await expect(page.getByRole('tabpanel')).toContainText('Connexion requise')

  await page.getByRole('button', { name: 'Se connecter' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('La connexion automatique n’est pas disponible')
  await dialog.getByLabel(/Jeton d’accès/).fill('jeton-bidon-pour-test')
  await dialog.getByRole('button', { name: 'Valider' }).click()
  await dialog.getByRole('button', { name: 'Se déconnecter' }).waitFor()
  await page.keyboard.press('Escape')

  // Le service réel refuse ce faux jeton : le message est affiché, pas un spinner infini.
  await expect(page.getByRole('tabpanel')).toContainText(/Jeton refusé ou expiré/, { timeout: 30_000 })
})

test('contact du producteur : adresse courriel publiée dans les métadonnées', async ({ page }) => {
  await pickBdTopo(page)
  const contact = page.getByRole('region', { name: 'Contacter le producteur' })
  await expect(contact).toBeVisible()
  await expect(contact.getByRole('link', { name: /@/ }).first()).toHaveAttribute('href', /^mailto:[^?]+@[^?]+\?subject=/)
  await expect(contact.getByRole('button', { name: 'Copier l’adresse' }).first()).toBeVisible()
})

test('donnée à accès restreint : le contact du producteur est proposé pour demander l’accès', async ({ page }) => {
  await search(page, 'orthophotographie infrarouge')
  const restricted = page.locator('.da-result', { hasText: 'Accès restreint' }).first()
  await expect(restricted).toBeVisible({ timeout: 30_000 })
  await restricted.click()
  await expect(page.getByText(/contact du producteur ci-dessous/)).toBeVisible()
  const contact = page.getByRole('region', { name: 'Contacter le producteur' })
  // L'adresse n'est affichée que si les métadonnées la publient ; sinon le message le dit.
  await expect(contact).toContainText(/@|Aucune adresse courriel|Aucun contact/)
})

test('recherche intelligente : activation locale du modèle puis recherche', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/')
  await expect(page.getByText(/aucun service externe/)).toBeVisible()
  await page.getByRole('button', { name: 'Activer la recherche intelligente' }).click()
  await expect(page.getByText('Recherche intelligente activée')).toBeVisible({ timeout: 200_000 })
  await page.getByLabel(/Que cherchez-vous/).fill('photos prises d’avion')
  await expect(page.locator('.da-result').first()).toContainText(/ORTHO|aérienne/i, { timeout: 30_000 })
})
