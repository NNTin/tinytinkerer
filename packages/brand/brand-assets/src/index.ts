import type { BrandDefinition } from '@tinytinkerer/contracts'

export { LICENSE_TEXT } from './license.generated'
export { TINYTINKERER_SOCIALS, TINYTINKERER_LICENSE, type BrandSocial } from './brand-links'
export {
  TINYTINKERER_CREDITS,
  TINYTINKERER_CREDITS_TITLE,
  type BrandCredit
} from './credits'
export { BrandSettingsFooter } from './react'

export const TINYTINKERER_BRAND_ASSET_URLS = {
  faviconIco: new URL('../assets/generated/favicon.ico', import.meta.url).href,
  favicon16: new URL('../assets/generated/favicon-16.png', import.meta.url).href,
  favicon32: new URL('../assets/generated/favicon-32.png', import.meta.url).href,
  favicon48: new URL('../assets/generated/favicon-48.png', import.meta.url).href,
  appleTouchIcon180: new URL('../assets/generated/apple-touch-icon-180.png', import.meta.url).href,
  icon192: new URL('../assets/generated/icon-192.png', import.meta.url).href,
  icon512: new URL('../assets/generated/icon-512.png', import.meta.url).href,
  iconMaskable512: new URL('../assets/generated/icon-maskable-512.png', import.meta.url).href
} as const

export const TINYTINKERER_BRAND: BrandDefinition = {
  theme: {
    applicationName: 'tinytinkerer',
    themeColor: '#f6f2ec',
    backgroundColor: '#fffaf5'
  },
  links: [
    {
      rel: 'icon',
      href: TINYTINKERER_BRAND_ASSET_URLS.faviconIco,
      type: 'image/x-icon'
    },
    {
      rel: 'icon',
      href: TINYTINKERER_BRAND_ASSET_URLS.favicon16,
      type: 'image/png',
      sizes: '16x16'
    },
    {
      rel: 'icon',
      href: TINYTINKERER_BRAND_ASSET_URLS.favicon32,
      type: 'image/png',
      sizes: '32x32'
    },
    {
      rel: 'icon',
      href: TINYTINKERER_BRAND_ASSET_URLS.favicon48,
      type: 'image/png',
      sizes: '48x48'
    },
    {
      rel: 'apple-touch-icon',
      href: TINYTINKERER_BRAND_ASSET_URLS.appleTouchIcon180,
      type: 'image/png',
      sizes: '180x180'
    }
  ],
  manifest: {
    name: 'tinytinkerer',
    shortName: 'tinytinkerer',
    description: 'TinyTinkerer app icons and branding metadata for web, widget, and future mobile shells.',
    startUrl: '/',
    display: 'standalone',
    backgroundColor: '#fffaf5',
    themeColor: '#f6f2ec',
    icons: [
      {
        src: TINYTINKERER_BRAND_ASSET_URLS.icon192,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: TINYTINKERER_BRAND_ASSET_URLS.icon512,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: TINYTINKERER_BRAND_ASSET_URLS.iconMaskable512,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      }
    ]
  }
}
