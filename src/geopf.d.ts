declare module 'geoportal-access-lib' {
  const Gp: {
    Services: {
      getConfig(options: { apiKey: string; onSuccess: (data: unknown) => void; onFailure: (error: { message?: string }) => void }): void
    }
    Config?: unknown
  }
  export default Gp
}
declare module 'geopf-extensions-openlayers/src/packages/CRS/AutoLoadCRS.js'
declare module 'geopf-extensions-openlayers' {
  import type { Control } from 'ol/control'
  import type BaseLayer from 'ol/layer/Base'
  type Ctor<T> = new (options?: Record<string, unknown>) => T
  export const GeoportalZoom: Ctor<Control>
  export const GeoportalAttribution: Ctor<Control>
  export const GeoportalFullScreen: Ctor<Control>
  export const SearchEngine: Ctor<Control>
  export const LayerSwitcher: Ctor<Control>
  export const MousePosition: Ctor<Control>
  export const LayerWMTS: Ctor<BaseLayer>
  export const LayerWMS: Ctor<BaseLayer>
}
