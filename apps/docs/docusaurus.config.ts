import type { Config } from '@docusaurus/types'
import {
  resolveDocsBaseUrl,
  resolveDocsLabCustomFields,
  resolveProductBaseUrl
} from './site-config'

const deployBase = process.env.TINYTINKERER_DEPLOY_BASE
const baseUrl = resolveDocsBaseUrl(deployBase)
const productBaseUrl = resolveProductBaseUrl(deployBase)
// Same VITE_* vars the product's own Vite builds already read at their build time
// (see apps/host/src/main.tsx, packages/app/app-browser/src/create-browser-shell-root.tsx)
// — Turbo/Vercel supplies one shared process.env to the whole `pnpm build`, so this
// Node-side Docusaurus config sees the identical values. Kept out of themeConfig
// (which is deep-merged and end-user documented) and off customFields' top level
// (reserved for arbitrary site metadata) — resolveDocsLabCustomFields gives the
// LiveLab framework its own namespaced, typed slice.
const docsLabCustomFields = resolveDocsLabCustomFields(deployBase, {
  edgeBaseUrl: process.env.VITE_EDGE_URL,
  githubClientId: process.env.VITE_GITHUB_CLIENT_ID,
  sentryDsn: process.env.VITE_SENTRY_DSN,
  sentryEnvironment: process.env.VITE_SENTRY_ENVIRONMENT
})
// This points outside the Docusaurus router (from /docs/ back to the product).
// Without these flags Docusaurus prepends its own base URL and treats the
// destination as a documentation route during link validation.
const productLink = {
  href: productBaseUrl,
  autoAddBaseUrl: false,
  target: '_top'
} as const

const config: Config = {
  title: 'TinyTinkerer documentation',
  tagline: 'A Rube Goldberg machine for human-computer conversation.',
  url: 'https://tiny.nntin.xyz',
  baseUrl,
  trailingSlash: true,
  organizationName: 'NNTin',
  projectName: 'tinytinkerer',
  onBrokenLinks: 'throw',
  customFields: { ...docsLabCustomFields },
  presets: [
    [
      'classic',
      {
        blog: false,
        docs: {
          path: '../../docs',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: ({ docPath }: { docPath: string }) =>
            `https://github.com/NNTin/tinytinkerer/edit/develop/docs/${docPath}`
        },
        theme: {
          customCss: './src/css/custom.css'
        }
      }
    ]
  ],
  themeConfig: {
    navbar: {
      title: 'TinyTinkerer',
      items: [
        {
          ...productLink,
          label: 'Open TinyTinkerer',
          position: 'right'
        },
        {
          href: 'https://github.com/NNTin/tinytinkerer',
          label: 'GitHub',
          position: 'right'
        }
      ]
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'TinyTinkerer',
          items: [
            {
              ...productLink,
              label: 'Open the app'
            },
            {
              label: 'GitHub',
              href: 'https://github.com/NNTin/tinytinkerer'
            }
          ]
        }
      ],
      copyright: `Copyright © ${new Date().getFullYear()} TinyTinkerer contributors.`
    }
  }
}

export default config
