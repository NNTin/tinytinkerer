import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [sourceArg, outputArg, commit] = process.argv.slice(2)
if (!sourceArg || !outputArg || !commit) {
  throw new Error(
    'Usage: build-pixel-agents-assets.mjs <pixel-agents-source> <output-file> <commit>'
  )
}

const sourceRoot = resolve(sourceArg)
const outputPath = resolve(outputArg)
const assetsDir = join(sourceRoot, 'webview-ui', 'public', 'assets')
const importSource = (path) => import(pathToFileURL(join(sourceRoot, path)).href)

const [{ buildAssetIndex, buildFurnitureCatalog }, loaders, pngDecoder] = await Promise.all([
  importSource('core/src/assets/build.ts'),
  importSource('core/src/assets/loader.ts'),
  importSource('core/src/assets/pngDecoder.ts')
])

const furnitureCatalog = buildFurnitureCatalog(assetsDir)
const assetIndex = buildAssetIndex(assetsDir)

const petDirectories = (
  await readdir(join(assetsDir, 'pets'), { withFileTypes: true }).catch(() => [])
)
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b))

const pets = []
const petNames = []
for (const directory of petDirectories) {
  try {
    const base = join(assetsDir, 'pets', directory)
    const manifest = JSON.parse(await readFile(join(base, 'manifest.json'), 'utf8'))
    const png = await readFile(join(base, 'pet.png'))
    pets.push(pngDecoder.decodePetPng(png))
    petNames.push(typeof manifest.name === 'string' ? manifest.name : directory)
  } catch (error) {
    console.warn(
      `Skipping Pixel Agents pet ${directory}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

const defaultLayout = assetIndex.defaultLayout
  ? JSON.parse(await readFile(join(assetsDir, assetIndex.defaultLayout), 'utf8'))
  : null
const upstreamPackage = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'))

const bootstrap = {
  integrationVersion: 1,
  upstream: {
    commit,
    version: typeof upstreamPackage.version === 'string' ? upstreamPackage.version : 'unknown'
  },
  assets: {
    characters: loaders.decodeAllCharacters(assetsDir),
    pets,
    petNames,
    floors: loaders.decodeAllFloors(assetsDir),
    walls: loaders.decodeAllWalls(assetsDir),
    furnitureCatalog,
    furnitureSprites: loaders.decodeAllFurniture(assetsDir, furnitureCatalog)
  },
  defaultLayout
}

await mkdir(resolve(outputPath, '..'), { recursive: true })
await writeFile(outputPath, JSON.stringify(bootstrap))
console.log(`Generated Pixel Agents browser bootstrap at ${outputPath}`)
