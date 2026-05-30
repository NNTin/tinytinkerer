export type BrandSocial = {
  kind: 'github' | 'instagram' | 'linkedin'
  label: string
  href: string
}

export const TINYTINKERER_SOCIALS: readonly BrandSocial[] = [
  { kind: 'github', label: 'GitHub', href: 'https://github.com/nntin/tinytinkerer' },
  { kind: 'instagram', label: 'Instagram', href: 'https://instagram.com/thedinolino' },
  { kind: 'linkedin', label: 'LinkedIn', href: 'https://www.linkedin.com/in/tin-nguyen-019299279/' }
]

export const TINYTINKERER_LICENSE = {
  title: 'License',
  inquiriesHref: 'https://www.linkedin.com/in/tin-nguyen-019299279/'
} as const
