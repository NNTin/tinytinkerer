import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceImagePath = join(
  rootDir,
  'packages',
  'brand',
  'brand-assets',
  'assets',
  'source',
  'tinytinkerer.jpg'
)
const generatedDir = join(rootDir, 'packages', 'brand', 'brand-assets', 'assets', 'generated')
const licenseSourcePath = join(rootDir, 'LICENSE')
const licenseModulePath = join(
  rootDir,
  'packages',
  'brand',
  'brand-assets',
  'src',
  'license.generated.ts'
)

const PNG_OUTPUTS = [
  { fileName: 'favicon-16.png', size: 16 },
  { fileName: 'favicon-32.png', size: 32 },
  { fileName: 'favicon-48.png', size: 48 },
  { fileName: 'apple-touch-icon-180.png', size: 180 },
  { fileName: 'icon-192.png', size: 192 },
  { fileName: 'icon-512.png', size: 512 },
  { fileName: 'icon-maskable-512.png', size: 512 },
  { fileName: 'icon-1024.png', size: 1024 }
]

const ICO_SOURCES = ['favicon-16.png', 'favicon-32.png', 'favicon-48.png']

const generateLicenseModule = async () => {
  const licenseText = await readFile(licenseSourcePath, 'utf8')
  const module = `// AUTO-GENERATED from /LICENSE by scripts/generate-brand-assets.mjs — do not edit.\nexport const LICENSE_TEXT = ${JSON.stringify(licenseText)}\n`
  await writeFile(licenseModulePath, module)
}

const createSquarePng = async (inputBuffer, outputPath, size) => {
  await sharp(inputBuffer)
    .resize(size, size, {
      fit: 'cover',
      position: 'centre'
    })
    .png()
    .toFile(outputPath)
}

const main = async () => {
  await stat(sourceImagePath)

  await rm(generatedDir, { recursive: true, force: true })
  await mkdir(generatedDir, { recursive: true })

  const sourceBuffer = await sharp(sourceImagePath).autoOrient().toBuffer()

  for (const output of PNG_OUTPUTS) {
    await createSquarePng(sourceBuffer, join(generatedDir, output.fileName), output.size)
  }

  const icoBuffer = await pngToIco(
    await Promise.all(ICO_SOURCES.map(async (fileName) => readFile(join(generatedDir, fileName))))
  )

  await writeFile(join(generatedDir, 'favicon.ico'), icoBuffer)

  await generateLicenseModule()

  console.log(`Generated ${PNG_OUTPUTS.length + 1} brand assets in ${generatedDir}`)
  console.log(`Generated license module at ${licenseModulePath}`)
}

main().catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error(message)
  process.exitCode = 1
})
