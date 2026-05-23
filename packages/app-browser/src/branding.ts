import { TINYTINKERER_BRAND } from '@tinytinkerer/brand-assets'

const MANAGED_ATTR = 'data-tinytinkerer-brand'

type ManagedLink = {
  key: string
  rel: string
  href: string
  type?: string
  sizes?: string
  color?: string
}

type ManagedMeta = {
  key: string
  name: string
  content: string
}

const createManifestDataUrl = (): string => {
  const manifest = {
    name: TINYTINKERER_BRAND.manifest.name,
    short_name: TINYTINKERER_BRAND.manifest.shortName,
    ...(TINYTINKERER_BRAND.manifest.description
      ? { description: TINYTINKERER_BRAND.manifest.description }
      : {}),
    start_url: TINYTINKERER_BRAND.manifest.startUrl,
    display: TINYTINKERER_BRAND.manifest.display,
    background_color: TINYTINKERER_BRAND.manifest.backgroundColor,
    theme_color: TINYTINKERER_BRAND.manifest.themeColor,
    icons: TINYTINKERER_BRAND.manifest.icons.map((icon) => ({
      src: icon.src,
      sizes: icon.sizes,
      type: icon.type,
      ...(icon.purpose ? { purpose: icon.purpose } : {})
    }))
  }

  return `data:application/manifest+json;charset=utf-8,${encodeURIComponent(
    JSON.stringify(manifest)
  )}`
}

const managedLinks = (): ManagedLink[] => [
  ...TINYTINKERER_BRAND.links.map((link, index) => ({
    key: `link:${index}`,
    rel: link.rel,
    href: link.href,
    ...(link.type ? { type: link.type } : {}),
    ...(link.sizes ? { sizes: link.sizes } : {}),
    ...(link.color ? { color: link.color } : {})
  })),
  {
    key: 'manifest',
    rel: 'manifest',
    href: createManifestDataUrl(),
    type: 'application/manifest+json'
  }
]

const managedMeta = (): ManagedMeta[] => [
  {
    key: 'application-name',
    name: 'application-name',
    content: TINYTINKERER_BRAND.theme.applicationName
  },
  {
    key: 'apple-mobile-web-app-title',
    name: 'apple-mobile-web-app-title',
    content: TINYTINKERER_BRAND.theme.applicationName
  },
  {
    key: 'theme-color',
    name: 'theme-color',
    content: TINYTINKERER_BRAND.theme.themeColor
  }
]

const upsertLink = (head: HTMLHeadElement, link: ManagedLink): void => {
  let element = head.querySelector(`link[${MANAGED_ATTR}="${link.key}"]`) as HTMLLinkElement | null
  if (!element) {
    element = document.createElement('link')
    element.setAttribute(MANAGED_ATTR, link.key)
    head.appendChild(element)
  }

  element.rel = link.rel
  element.href = link.href

  if (link.type) {
    element.type = link.type
  } else {
    element.removeAttribute('type')
  }

  if (link.sizes) {
    element.setAttribute('sizes', link.sizes)
  } else {
    element.removeAttribute('sizes')
  }

  if (link.color) {
    element.setAttribute('color', link.color)
  } else {
    element.removeAttribute('color')
  }
}

const upsertMeta = (head: HTMLHeadElement, meta: ManagedMeta): void => {
  let element = head.querySelector(`meta[${MANAGED_ATTR}="${meta.key}"]`) as HTMLMetaElement | null
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(MANAGED_ATTR, meta.key)
    head.appendChild(element)
  }

  element.name = meta.name
  element.content = meta.content
}

const removeStaleManagedElements = (activeKeys: Set<string>): void => {
  for (const element of document.head.querySelectorAll(`[${MANAGED_ATTR}]`)) {
    const key = element.getAttribute(MANAGED_ATTR)
    if (key && !activeKeys.has(key)) {
      element.remove()
    }
  }
}

export const applyBrandMetadata = (): void => {
  if (typeof document === 'undefined' || !document.head) {
    return
  }

  const activeKeys = new Set<string>()

  for (const link of managedLinks()) {
    activeKeys.add(link.key)
    upsertLink(document.head, link)
  }

  for (const meta of managedMeta()) {
    activeKeys.add(meta.key)
    upsertMeta(document.head, meta)
  }

  removeStaleManagedElements(activeKeys)
}
