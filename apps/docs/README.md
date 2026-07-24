# TinyTinkerer documentation app

This workspace builds the repository's root [`docs/`](../../docs) directory with Docusaurus and
is composed into the main frontend at `/docs/`.

The package intentionally does not set `"type": "module"`. Docusaurus generates a
`.docusaurus/registry.js` module that uses webpack's CommonJS `require.resolveWeak` transform
during its server build. Marking this package as ESM makes webpack leave that generated call for
Node to execute during static rendering, where it fails because Node's `require` has no
`resolveWeak` method. The TypeScript Docusaurus configuration and application source still use
ES modules.

Run the documentation site through the unified root development command:

```sh
pnpm dev
```

The standalone Docusaurus server remains available for focused authoring:

```sh
pnpm --filter @tinytinkerer/docs dev
```
