import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as {
  version: string
}

// The ONLY imports the published bundle may leave for a host to resolve. Both
// are peers; everything else — workspace packages and their third-party
// dependencies alike — is compiled in. scripts/check-package.mjs fails the
// build if any other bare import survives.
const PEER = /^react(-dom)?(\/.*)?$/

// `virtual:pwa-register` is vite-plugin-pwa's module, provided only to the
// deployable shells that emit a service worker. app-browser reaches it solely
// through `createBrowserShellRoot`, which this entry does not export, so the
// import is tree-shaken out — but it must still RESOLVE first. An embedded
// assistant must never register TinyTinkerer's service worker on a host's
// origin, so the stub makes registration impossible rather than merely absent.
const noServiceWorker = (): Plugin => ({
  name: 'tinytinkerer-embed:no-service-worker',
  resolveId: (id) => (id === 'virtual:pwa-register' ? '\0embed-no-pwa-register' : undefined),
  load: (id) =>
    id === '\0embed-no-pwa-register'
      ? "export const registerSW = () => { throw new Error('An embedded TinyTinkerer never registers a service worker.') }"
      : undefined
})

// Library mode inlines EVERY asset as a data: URL, whatever assetsInlineLimit
// says (Vite's `shouldInline` short-circuits on `build.lib`). For this package
// that would put the brand icons (~1.7 MB of base64) on the entry's static
// graph and the mermaid runtime (~3 MB) into its chunk as a string. Vite's own
// opt-out is a `no-inline` query, so asset references in the bundled
// workspace sources get one: assets are emitted as files, referenced through
// `new URL(..., import.meta.url)` — which the host's bundler re-emits — and
// fetched only if the code that names them runs.
const emitAssetsAsFiles = (): Plugin => ({
  name: 'tinytinkerer-embed:emit-assets-as-files',
  enforce: 'pre',
  transform(code, id) {
    if (
      id.includes('node_modules') ||
      !/[/\\]packages[/\\]/.test(id) ||
      !/\.[cm]?[jt]sx?$/.test(id)
    ) {
      return undefined
    }
    const rewritten = code
      .replace(
        /new URL\((['"])([^'"?]+\.(?:png|ico|svg|jpe?g|webp|gif|woff2?))\1,\s*import\.meta\.url\)/g,
        (_match, quote: string, path: string) =>
          `new URL(${quote}${path}?no-inline${quote}, import.meta.url)`
      )
      .replace(
        /(['"])([^'"]+)\?url\1/g,
        (_match, quote: string, path: string) => `${quote}${path}?url&no-inline${quote}`
      )
    return rewritten === code ? undefined : { code: rewritten, map: null }
  }
})

// Records the bundler's own chunk graph — every chunk's static imports,
// dynamic imports and size — for scripts/check-package.mjs. Asking the bundler
// rather than re-parsing its output is the point: bundled parsers (prettier,
// micromark) are full of strings and comments that look like imports. Written
// outside dist/, so it is never published.
const recordBundleGraph = (): Plugin => ({
  name: 'tinytinkerer-embed:bundle-graph',
  generateBundle(_options, bundle) {
    const graph: Record<string, { imports: string[]; dynamicImports: string[]; bytes: number }> = {}
    for (const [fileName, output] of Object.entries(bundle)) {
      // The stylesheet entries' empty JS stubs, which Vite drops after this hook.
      if (output.type === 'chunk' && !output.facadeModuleId?.endsWith('.css')) {
        graph[fileName] = {
          imports: output.imports,
          dynamicImports: output.dynamicImports,
          bytes: Buffer.byteLength(output.code)
        }
      }
    }
    mkdirSync(new URL('./.build/', import.meta.url), { recursive: true })
    writeFileSync(
      new URL('./.build/bundle-graph.json', import.meta.url),
      JSON.stringify(graph, null, 2)
    )
  }
})

export default defineConfig({
  plugins: [emitAssetsAsFiles(), react(), tailwindcss(), noServiceWorker(), recordBundleGraph()],
  define: {
    // Read by app-browser modules this entry does not export
    // (createBrowserShellRoot); defined so a stray reference can never be a
    // ReferenceError in a host.
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_HASH__: JSON.stringify(`embed-${version}`),
    // A library build must not inherit Vite's per-app env. The host owns its
    // own mode; nothing bundled here may read the embedder's build env.
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // No source maps: the bundle is published, and maps would publish the
    // workspace's source tree with it.
    sourcemap: false,
    // Hosts minify their own output; shipping readable modules keeps stack
    // traces and `npm view` diffs legible at no cost to the host's bundle.
    minify: false,
    cssCodeSplit: true,
    lib: {
      entry: {
        index: 'src/index.ts',
        // The side-effect-free `/oauth` subpath (issue #518, F3). Modules it
        // shares with `index` land in one small shared chunk; check-package.mjs
        // asserts nothing else is on its static graph.
        oauth: 'src/oauth.ts',
        embed: 'src/embed.css',
        styles: 'src/styles.css'
      },
      formats: ['es']
    },
    rollupOptions: {
      external: (id) => PEER.test(id),
      output: {
        entryFileNames: '[name].js',
        // A chunk whose entry module belongs to a plugin or a content renderer
        // is named after that package, so scripts/check-package.mjs can assert
        // by NAME that none of them is on the entry's static import graph.
        chunkFileNames: (chunk) => {
          const owner =
            /[/\\]packages[/\\](?:plugins|content[/\\]renderers)[/\\]([^/\\]+)[/\\]/.exec(
              chunk.facadeModuleId ?? ''
            )?.[1]
          return owner ? `chunks/${owner}-[hash].js` : 'chunks/[name]-[hash].js'
        },
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith('.css'))
            ? '[name][extname]'
            : 'assets/[name]-[hash][extname]'
      }
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})
