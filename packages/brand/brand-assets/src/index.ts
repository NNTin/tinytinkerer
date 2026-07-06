// Pure re-export barrel of brand metadata, links, credits, and generated
// license/notice text. This package is a renderer-agnostic metadata leaf: it
// owns no React components or DOM code (the About footer and its dialogs live in
// app-browser, which consumes this data). It has no top-level side effects (the
// asset-URL definitions live in ./brand-definition) so that, combined with
// "sideEffects": false in package.json, bundlers can tree-shake the parts an
// importer doesn't use.
export { LICENSE_TEXT } from './license.generated'
export { THIRD_PARTY_NOTICES } from './third-party-notices.generated'
export { TINYTINKERER_SOCIALS, TINYTINKERER_LICENSE, type BrandSocial } from './brand-links'
export {
  TINYTINKERER_CREDITS,
  TINYTINKERER_CREDITS_TITLE,
  TINYTINKERER_CREDITS_NOTE,
  type BrandCredit
} from './credits'
export { TINYTINKERER_BRAND, TINYTINKERER_BRAND_ASSET_URLS } from './brand-definition'
