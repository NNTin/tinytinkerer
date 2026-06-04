// Pure re-export barrel. It deliberately contains no top-level side effects (the
// asset-URL definitions live in ./brand-definition) so that, combined with
// "sideEffects": false in package.json, bundlers can tree-shake the parts an
// importer doesn't use. In particular, app entry chunks that only need the brand
// metadata won't pull in BrandSettingsFooter and its React-icon dependencies —
// those stay in the lazily-loaded settings-modal chunk.
export { LICENSE_TEXT } from './license.generated'
export { TINYTINKERER_SOCIALS, TINYTINKERER_LICENSE, type BrandSocial } from './brand-links'
export {
  TINYTINKERER_CREDITS,
  TINYTINKERER_CREDITS_TITLE,
  TINYTINKERER_CREDITS_NOTE,
  type BrandCredit
} from './credits'
export { TINYTINKERER_BRAND, TINYTINKERER_BRAND_ASSET_URLS } from './brand-definition'
export { BrandSettingsFooter } from './react'
