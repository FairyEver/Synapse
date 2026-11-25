import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as esbuild from "esbuild"

const __dirname = dirname(fileURLToPath(import.meta.url))
const sdkRoot = resolve(__dirname, "..")
const distRoot = resolve(sdkRoot, "dist")
const releasesRoot = resolve(sdkRoot, "releases")
const require = createRequire(import.meta.url)

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)$/

function parseSemver(version) {
  const match = SEMVER_REGEX.exec(version)
  if (!match) throw new Error(`Invalid semver version: ${version}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareSemverDesc(a, b) {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pb[i] - pa[i]
  }
  return 0
}

function fileIntegrityAndBytes(filePath) {
  const buffer = readFileSync(filePath)
  const integrity = `sha256-${createHash("sha256").update(buffer).digest("base64")}`
  return { integrity, bytes: buffer.byteLength }
}

function bundleDeclarationFile(entryDtsPath) {
  const visited = new Set()
  const chunks = []

  function resolveRelativeDts(fromFile, specifier) {
    const clean = specifier.replace(/\.m?js$/u, "")
    const baseDir = dirname(fromFile)
    const direct = resolve(baseDir, `${clean}.d.ts`)
    if (existsSync(direct)) return direct
    const indexCandidate = resolve(baseDir, clean, "index.d.ts")
    if (existsSync(indexCandidate)) return indexCandidate
    throw new Error(`Unable to resolve declaration import "${specifier}" from "${fromFile}"`)
  }

  function visit(filePath, isEntry) {
    const abs = resolve(filePath)
    if (visited.has(abs)) return
    visited.add(abs)

    const raw = readFileSync(abs, "utf8")
    const lines = raw.split(/\r?\n/u)
    const keptLines = []

    for (const line of lines) {
      const importMatch = /^\s*import\s+(?:type\s+)?[\s\S]*?\s+from\s+["'](\.[^"']+)["'];?\s*$/u.exec(line)
      if (importMatch) {
        visit(resolveRelativeDts(abs, importMatch[1]), false)
        continue
      }
      const reExportMatch = /^\s*export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["'](\.[^"']+)["'];?\s*$/u.exec(line)
      if (reExportMatch) {
        visit(resolveRelativeDts(abs, reExportMatch[2]), false)
        if (isEntry) {
          keptLines.push(line.replace(/\s+from\s+["'][^"']+["']/u, ""))
        }
        continue
      }
      const starExportMatch = /^\s*export\s+\*\s+from\s+["'](\.[^"']+)["'];?\s*$/u.exec(line)
      if (starExportMatch) {
        visit(resolveRelativeDts(abs, starExportMatch[1]), false)
        continue
      }
      if (/^\s*export\s+\{\s*\};\s*$/u.test(line)) {
        continue
      }
      if (!isEntry) {
        keptLines.push(line.replace(/^export\s+(?=(?:declare\s+|interface\s+|type\s+|class\s+|function\s+|const\s+|enum\s+))/u, ""))
      } else {
        keptLines.push(line)
      }
    }

    const body = keptLines.join("\n").trim()
    if (body) {
      chunks.push(body)
    }
  }

  visit(entryDtsPath, true)
  const bundled = `${chunks.join("\n\n")}\n`
  if (/from\s+["']\.\.?\//u.test(bundled)) {
    throw new Error("Bundled index.d.ts still contains a relative import")
  }
  return bundled
}

function emitStandaloneTypes(entryRelativePath, outFile) {
  const tscBin = require.resolve("typescript/bin/tsc")
  const tempDir = mkdtempSync(join(tmpdir(), "synapse-sdk-dts-"))
  try {
    const tempTsconfig = join(tempDir, "tsconfig.dts.json")
    const dtsOutDir = join(tempDir, "out")
    writeFileSync(
      tempTsconfig,
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            lib: ["ES2022", "DOM"],
            strict: true,
            skipLibCheck: true,
            declaration: true,
            emitDeclarationOnly: true,
            rootDir: resolve(sdkRoot, "src"),
            outDir: dtsOutDir,
          },
          files: [resolve(sdkRoot, entryRelativePath)],
        },
        null,
        2,
      ),
    )

    execFileSync(process.execPath, [tscBin, "-p", tempTsconfig], {
      cwd: sdkRoot,
      stdio: "pipe",
    })

    const emittedEntry = join(dtsOutDir, entryRelativePath.replace(/^src\//u, "").replace(/\.ts$/u, ".d.ts"))
    const standalone = bundleDeclarationFile(emittedEntry)
    writeFileSync(outFile, standalone, "utf8")
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function buildStateSyncSdk(version, publicOrigin) {
  const sdkName = "state-sync"
  const [majorNum] = parseSemver(version)
  const majorTag = `v${majorNum}`
  const sdkDistDir = resolve(distRoot, sdkName)
  const exactVersionDir = resolve(sdkDistDir, version)
  const majorVersionDir = resolve(sdkDistDir, majorTag)

  mkdirSync(exactVersionDir, { recursive: true })

  // 1. Merge frozen historical releases first so current build stays authoritative for `version`.
  const frozenRoot = resolve(releasesRoot, sdkName)
  const discoveredVersions = new Set([version])
  if (existsSync(frozenRoot)) {
    for (const entry of readdirSync(frozenRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (!SEMVER_REGEX.test(entry.name)) continue
      discoveredVersions.add(entry.name)
      if (entry.name !== version) {
        cpSync(resolve(frozenRoot, entry.name), resolve(sdkDistDir, entry.name), { recursive: true })
      }
    }
  }

  // 2. Bundle JS outputs via esbuild from single zero-dependency TS source.
  const entryPoint = resolve(sdkRoot, "src", "state-sync", "index.ts")
  const globalOut = resolve(exactVersionDir, "state-sync.global.min.js")
  const esmOut = resolve(exactVersionDir, "state-sync.esm.min.js")
  const cjsOut = resolve(exactVersionDir, "state-sync.cjs")
  const dtsOut = resolve(exactVersionDir, "index.d.ts")

  await Promise.all([
    esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      format: "iife",
      globalName: "SynapseStateSync",
      minify: true,
      target: ["es2020"],
      platform: "browser",
      outfile: globalOut,
    }),
    esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      format: "esm",
      minify: true,
      target: ["es2020"],
      platform: "neutral",
      outfile: esmOut,
    }),
    esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      format: "cjs",
      minify: true,
      target: ["es2020"],
      platform: "neutral",
      outfile: cjsOut,
    }),
  ])

  // 3. Emit standalone self-contained index.d.ts via tsc --emitDeclarationOnly.
  emitStandaloneTypes("src/state-sync/index.ts", dtsOut)

  // 4. Populate floating major alias (v1/) from latest version in this major line.
  const sortedVersions = [...discoveredVersions].sort(compareSemverDesc)
  const latestInMajor = sortedVersions.find((v) => parseSemver(v)[0] === majorNum) ?? version
  const latestOverall = sortedVersions[0] ?? version
  cpSync(resolve(sdkDistDir, latestInMajor), majorVersionDir, { recursive: true })

  // 5. Compute SRI hashes and byte lengths for latest version files.
  const latestDir = resolve(sdkDistDir, latestOverall)
  const buildFileEntry = (filename) => {
    const { integrity, bytes } = fileIntegrityAndBytes(resolve(latestDir, filename))
    return {
      url: `/sdk/${sdkName}/${latestOverall}/${filename}`,
      latestUrl: `/sdk/${sdkName}/${majorTag}/${filename}`,
      integrity,
      bytes,
    }
  }

  const files = {
    browserGlobal: buildFileEntry("state-sync.global.min.js"),
    esm: buildFileEntry("state-sync.esm.min.js"),
    cjs: buildFileEntry("state-sync.cjs"),
    types: buildFileEntry("index.d.ts"),
  }

  const normalizedOrigin = publicOrigin.replace(/\/+$/u, "")
  const sdkManifest = {
    schemaVersion: 1,
    name: sdkName,
    title: "Synapse State Sync SDK",
    latest: latestOverall,
    major: majorTag,
    globalName: "SynapseStateSync",
    docsUrl: "/document/open-api/api/state-sync",
    nodeDownloadCommand: `curl -fsSL ${normalizedOrigin}${files.esm.latestUrl} -o ./synapse-state-sync.mjs`,
    files,
    versions: sortedVersions,
  }

  writeFileSync(resolve(sdkDistDir, "manifest.json"), `${JSON.stringify(sdkManifest, null, 2)}\n`, "utf8")

  return {
    name: sdkManifest.name,
    title: sdkManifest.title,
    manifestUrl: `/sdk/${sdkName}/manifest.json`,
    latest: sdkManifest.latest,
    major: sdkManifest.major,
    globalName: sdkManifest.globalName,
    docsUrl: sdkManifest.docsUrl,
    nodeDownloadCommand: sdkManifest.nodeDownloadCommand,
    files: sdkManifest.files,
    versions: sdkManifest.versions,
  }
}

async function main() {
  const pkg = JSON.parse(readFileSync(resolve(sdkRoot, "package.json"), "utf8"))
  const version = pkg.version
  const publicOrigin = process.env.APP_PUBLIC_URL || "https://synapse.d2.pub"

  rmSync(distRoot, { recursive: true, force: true })
  mkdirSync(distRoot, { recursive: true })

  const stateSyncEntry = await buildStateSyncSdk(version, publicOrigin)

  const rootManifest = {
    schemaVersion: 1,
    sdks: {
      "state-sync": stateSyncEntry,
    },
  }

  writeFileSync(resolve(distRoot, "manifest.json"), `${JSON.stringify(rootManifest, null, 2)}\n`, "utf8")
  process.stdout.write(`Built @synapse/sdk state-sync@${version} -> ${distRoot}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
