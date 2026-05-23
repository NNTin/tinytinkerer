import { brandDefinitionSchema, type BrandDefinition } from '@tinytinkerer/contracts'

const toDataUrl = (mimeType: string, value: string): string =>
  `data:${mimeType};charset=utf-8,${encodeURIComponent(value)}`

const primaryIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="TinyTinkerer placeholder icon">
  <rect width="128" height="128" rx="28" fill="#25231d" />
  <circle cx="64" cy="46" r="18" fill="#f59e0b" />
  <path d="M34 94c8-18 20-27 30-27 15 0 25 10 30 27" fill="none" stroke="#fffaf5" stroke-linecap="round" stroke-width="12" />
</svg>`.trim()

const maskIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#000" />
  <circle cx="64" cy="46" r="18" fill="#fff" />
  <path d="M34 94c8-18 20-27 30-27 15 0 25 10 30 27" fill="none" stroke="#fff" stroke-linecap="round" stroke-width="12" />
</svg>`.trim()

const primaryIconUrl = toDataUrl('image/svg+xml', primaryIconSvg)
const maskIconUrl = toDataUrl('image/svg+xml', maskIconSvg)

export const TINYTINKERER_BRAND: BrandDefinition = brandDefinitionSchema.parse({
  theme: {
    applicationName: 'tinytinkerer',
    themeColor: '#f6f2ec',
    backgroundColor: '#fffaf5'
  },
  links: [
    {
      rel: 'icon',
      href: primaryIconUrl,
      type: 'image/svg+xml',
      sizes: 'any'
    },
    {
      rel: 'apple-touch-icon',
      href: primaryIconUrl,
      type: 'image/svg+xml',
      sizes: '180x180'
    },
    {
      rel: 'mask-icon',
      href: maskIconUrl,
      type: 'image/svg+xml',
      color: '#25231d'
    }
  ],
  manifest: {
    name: 'tinytinkerer',
    shortName: 'tinker',
    description: 'Placeholder PWA metadata for TinyTinkerer.',
    startUrl: '/',
    display: 'standalone',
    backgroundColor: '#fffaf5',
    themeColor: '#f6f2ec',
    icons: [
      {
        src: primaryIconUrl,
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any'
      }
    ]
  }
})
