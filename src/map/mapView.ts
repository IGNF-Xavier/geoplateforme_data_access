/**
 * Carte OpenLayers + extensions Géoplateforme (geopf-extensions-openlayers, thème DSFR) :
 * couches Plan IGN / photographies aériennes, zoom, recherche d'adresse, sélecteur de
 * couches, coordonnées du curseur et attributions. La configuration Géoplateforme (lot
 * `essentiels`) est lue au démarrage ; si elle est indisponible, un fond WMTS direct et
 * les contrôles OpenLayers de base prennent le relais : l'application reste utilisable.
 *
 * Aucune donnée vectorielle volumineuse n'est chargée côté navigateur : seules des
 * tuiles/images servies par la Géoplateforme.
 */
import type { Polygon } from 'geojson'
import Gp from 'geoportal-access-lib'
import {
  GeoportalAttribution, GeoportalZoom, LayerSwitcher, LayerWMTS, MousePosition, SearchEngine,
} from 'geopf-extensions-openlayers'
import 'geopf-extensions-openlayers/src/packages/CRS/AutoLoadCRS.js'
import { Feature, Map, View } from 'ol'
import { defaults as defaultControls, ScaleLine } from 'ol/control'
import GeoJSON from 'ol/format/GeoJSON'
import Draw, { createBox } from 'ol/interaction/Draw'
import type BaseLayer from 'ol/layer/Base'
import TileLayer from 'ol/layer/Tile'
import VectorLayer from 'ol/layer/Vector'
import { fromLonLat, transformExtent } from 'ol/proj'
import TileWMS from 'ol/source/TileWMS'
import VectorSource from 'ol/source/Vector'
import XYZ from 'ol/source/XYZ'
import { Fill, Stroke, Style } from 'ol/style'
import { describeWmtsLayer, wmtsTileUrlTemplate } from '../api/wmts'
import { GEOPF_CONFIG_KEY } from '../config'
import type { BBox, ServiceAccess } from '../types'
import type { Geometry } from '../utils/geo'

/** Fond de secours : couche WMTS vérifiée (style `normal`, jeu `PM`, PNG). */
const FALLBACK_BASE_URL =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2' +
  '&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'

const geojson = new GeoJSON()
const areaStyle = new Style({
  stroke: new Stroke({ color: '#000091', width: 3 }),
  fill: new Fill({ color: 'rgba(0, 0, 145, 0.12)' }),
})
const drawStyle = new Style({
  stroke: new Stroke({ color: '#ce0500', width: 2, lineDash: [6, 4] }),
  fill: new Fill({ color: 'rgba(206, 5, 0, 0.08)' }),
})

export type DrawMode = 'rectangle' | 'polygon'

function loadGeoportalConfig(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Les couches et contrôles de l'extension lisent la configuration dans `window.Gp.Config`.
    ;(window as unknown as { Gp: typeof Gp }).Gp = Gp
    Gp.Services.getConfig({
      apiKey: GEOPF_CONFIG_KEY,
      onSuccess: (data) => {
        Gp.Config = data
        resolve()
      },
      onFailure: (error) => reject(new Error(error?.message || 'configuration Géoplateforme indisponible')),
    })
  })
}

export class MapView {
  readonly map: Map
  /** Vrai si les extensions Géoplateforme sont actives (sinon fond et contrôles de secours). */
  extensionsLoaded = false
  private previewLayer?: BaseLayer
  private readonly areaSource = new VectorSource()
  private draw?: Draw

  private constructor(target: HTMLElement) {
    this.map = new Map({
      target,
      controls: [],
      layers: [],
      view: new View({ center: fromLonLat([2.35, 46.6]), zoom: 5.5, maxZoom: 19 }),
    })
    // Calque de la zone : rattaché à la carte sans figurer dans le sélecteur de couches.
    new VectorLayer({ source: this.areaSource, style: areaStyle, zIndex: 10 }).setMap(this.map)
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.map.updateSize()).observe(target)
  }

  /** Crée la carte ; ne lève jamais d'exception : en cas d'échec des extensions, bascule sur le fond de secours. */
  static async create(target: HTMLElement): Promise<MapView> {
    const view = new MapView(target)
    try {
      await loadGeoportalConfig()
      view.addExtensions()
      view.extensionsLoaded = true
    } catch (error) {
      console.warn('Extensions Géoplateforme indisponibles, fond de secours :', error)
      view.addFallback()
    }
    return view
  }

  private addExtensions(): void {
    const plan = new LayerWMTS({ layer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2' })
    const ortho = new LayerWMTS({ layer: 'ORTHOIMAGERY.ORTHOPHOTOS' })
    ortho.setVisible(false)
    this.map.addLayer(plan)
    this.map.addLayer(ortho)
    for (const control of [
      new GeoportalZoom({ position: 'top-left' }),
      new SearchEngine({ collapsed: true, position: 'top-left' }),
      new LayerSwitcher({ options: { collapsed: true, position: 'top-right' } }),
      new MousePosition({ collapsed: true, position: 'bottom-left' }),
      new GeoportalAttribution(),
    ]) {
      this.map.addControl(control)
    }
    this.map.addControl(new ScaleLine())
  }

  private addFallback(): void {
    this.map.addLayer(
      new TileLayer({
        source: new XYZ({ url: FALLBACK_BASE_URL, maxZoom: 18, attributions: '© <a href="https://www.ign.fr/">IGN</a> – Géoplateforme' }),
      }),
    )
    defaultControls({ attributionOptions: { collapsible: false } }).forEach((c) => this.map.addControl(c))
    this.map.addControl(new ScaleLine())
  }

  /** Emprise visible, en WGS84. */
  getViewportBBox(): BBox {
    const extent = this.map.getView().calculateExtent(this.map.getSize())
    return transformExtent(extent, 'EPSG:3857', 'EPSG:4326') as BBox
  }

  fitBBox(bbox: BBox, padding = 40): void {
    this.map.getView().fit(transformExtent(bbox, 'EPSG:4326', 'EPSG:3857'), {
      padding: [padding, padding, padding, padding],
      maxZoom: 16,
      duration: 300,
    })
  }

  centerOn(lon: number, lat: number, zoom = 12): void {
    this.map.getView().animate({ center: fromLonLat([lon, lat]), zoom, duration: 300 })
  }

  showArea(geometry: Geometry | undefined): void {
    this.areaSource.clear()
    if (!geometry) return
    this.areaSource.addFeature(
      geojson.readFeature(
        { type: 'Feature', properties: {}, geometry },
        { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' },
      ) as Feature,
    )
  }

  /** Affiche la donnée choisie ; lève une erreur lisible si le service n'est pas exploitable. */
  async showPreview(access: ServiceAccess | undefined, signal?: AbortSignal): Promise<void> {
    this.clearPreview()
    if (!access) return
    let layer: BaseLayer
    if (access.kind === 'WMTS') {
      const info = access.capabilitiesUrl ? await describeWmtsLayer(access.capabilitiesUrl, access.layer, signal) : undefined
      if (!info) throw new Error(`La couche « ${access.layer} » est introuvable dans le service WMTS.`)
      layer = new TileLayer({
        opacity: 0.9,
        zIndex: 5,
        source: new XYZ({ url: wmtsTileUrlTemplate(access.endpoint, info), minZoom: info.minZoom, maxZoom: info.maxZoom }),
      })
    } else if (access.kind === 'WMS') {
      layer = new TileLayer({
        opacity: 0.9,
        zIndex: 5,
        source: new TileWMS({
          url: access.endpoint,
          params: { LAYERS: access.layer, FORMAT: 'image/png', VERSION: '1.3.0', STYLES: '' },
          serverType: 'geoserver',
        }),
      })
    } else {
      throw new Error('Ce service ne propose pas d’aperçu image (service vectoriel).')
    }
    this.previewLayer = layer
    this.map.addLayer(layer)
  }

  /** Signale une erreur de chargement de tuile : le troisième échec déclenche le callback. */
  onPreviewError(callback: () => void): void {
    const source = (this.previewLayer as TileLayer<XYZ | TileWMS> | undefined)?.getSource()
    if (!source) return
    let failures = 0
    source.on('tileloaderror', () => {
      failures += 1
      if (failures === 3) callback()
    })
  }

  clearPreview(): void {
    if (this.previewLayer) this.map.removeLayer(this.previewLayer)
    this.previewLayer = undefined
  }

  startDraw(mode: DrawMode, onDone: (geometry: Polygon) => void): void {
    this.stopDraw()
    const draw = new Draw(
      mode === 'rectangle'
        ? { type: 'Circle', geometryFunction: createBox(), style: drawStyle }
        : { type: 'Polygon', style: drawStyle },
    )
    draw.on('drawend', (event) => {
      const geometry = geojson.writeGeometryObject(event.feature.getGeometry()!, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857',
      }) as Polygon
      this.stopDraw()
      onDone(geometry)
    })
    this.map.addInteraction(draw)
    this.draw = draw
  }

  stopDraw(): void {
    if (this.draw) this.map.removeInteraction(this.draw)
    this.draw = undefined
  }

  get isDrawing(): boolean {
    return !!this.draw
  }
}
