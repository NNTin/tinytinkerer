import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectDependencyLicenses } from './lib/dependency-licenses.mjs'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = join(rootDir, process.env.SBOM_OUTPUT ?? 'sbom.json')

/** Build a Package URL (purl) for an npm component, preserving the scope namespace. */
const toPurl = (name, version) => {
  const encoded = name.startsWith('@')
    ? `${encodeURIComponent(name.split('/')[0])}/${encodeURIComponent(name.split('/').slice(1).join('/'))}`
    : encodeURIComponent(name)
  return version ? `pkg:npm/${encoded}@${version}` : `pkg:npm/${encoded}`
}

/** Map a license string onto a CycloneDX `licenses` array entry. */
const toLicenseEntry = (license) => {
  if (license === 'UNKNOWN') return [{ license: { name: 'UNKNOWN' } }]
  // SPDX expressions (with OR/AND/parens) use `expression`; plain ids use `id`.
  if (/[()]|\s(?:OR|AND|WITH)\s/i.test(license)) return [{ expression: license }]
  return [{ license: { id: license } }]
}

const main = () => {
  const dependencies = collectDependencyLicenses()
  const rootPkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))

  const sbom = {
    $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        {
          vendor: 'tinytinkerer',
          name: 'generate-sbom',
          version: String(rootPkg.version ?? '0.0.0')
        }
      ],
      component: {
        type: 'application',
        name: String(rootPkg.name ?? 'tinytinkerer'),
        version: String(rootPkg.version ?? '0.0.0')
      }
    },
    components: dependencies.map((dep) => ({
      type: 'library',
      name: dep.name,
      ...(dep.version ? { version: dep.version } : {}),
      ...(dep.description ? { description: dep.description } : {}),
      purl: toPurl(dep.name, dep.version),
      'bom-ref': toPurl(dep.name, dep.version),
      licenses: toLicenseEntry(dep.license)
    }))
  }

  writeFileSync(outputPath, `${JSON.stringify(sbom, null, 2)}\n`)
  console.log(`Generated SBOM with ${sbom.components.length} components at ${outputPath}`)
}

main()
