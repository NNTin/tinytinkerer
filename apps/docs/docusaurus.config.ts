import type { Config } from '@docusaurus/types'
import { resolveDocsBaseUrl, resolveProductBaseUrl } from './site-config'

const deployBase = process.env.TINYTINKERER_DEPLOY_BASE
const baseUrl = resolveDocsBaseUrl(deployBase)
const productBaseUrl = resolveProductBaseUrl(deployBase)
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
