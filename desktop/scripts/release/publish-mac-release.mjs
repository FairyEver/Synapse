#!/usr/bin/env node
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { prepareReleaseArtifacts } from "./prepare-cdn-release-artifacts.mjs"
import { pruneCosReleaseVersions } from "./prune-cos-release-versions.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptDir, "../..")
const repoRoot = path.resolve(packageRoot, "..")
const DEFAULT_CDN_BASE_URL = "https://desktop.release.synapse.d2.pub/"
const DEFAULT_COS_BUCKET = "synapse-desktop-release-1252371654"
const DEFAULT_COS_REGION = "ap-beijing"
const DEFAULT_COS_ENDPOINT = "cos.accelerate.myqcloud.com"
const CDN_REFRESH_REGION = "ap-guangzhou"
const COSCLI_DOWNLOADS = {
  "darwin-arm64": "https://cosbrowser.cloud.tencent.com/software/coscli/coscli-darwin-arm64",
  "darwin-x64": "https://cosbrowser.cloud.tencent.com/software/coscli/coscli-darwin-amd64",
  "linux-x64": "https://cosbrowser.cloud.tencent.com/software/coscli/coscli-linux-amd64",
  "linux-arm64": "https://cosbrowser.cloud.tencent.com/software/coscli/coscli-linux-arm64",
}
const DEFAULT_ENV_FILES = [
  ".env.release.local",
  ".env.local",
  ".env",
]

function hasArg(name) {
  return process.argv.includes(name)
}

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallback
  }
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`)
  }
  return value
}

function normalizeCdnBaseUrl(value) {
  if (!value.startsWith("https://")) {
    throw new Error("CDN base URL must start with https://")
  }
  return value.endsWith("/") ? value : `${value}/`
}

async function readPackageVersion() {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"))
  const version = String(packageJson.version ?? "").trim()
  if (!version) {
    throw new Error("desktop/package.json is missing version")
  }
  return version
}

function stripInlineComment(value) {
  let quote = null
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if ((char === "\"" || char === "'") && value[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char
      continue
    }
    if (char === "#" && quote === null) {
      return value.slice(0, index).trim()
    }
  }
  return value.trim()
}

function parseEnvValue(value) {
  const trimmed = stripInlineComment(value)
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

async function loadEnvFile(filePath) {
  const text = await readFile(filePath, "utf8")
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) {
      continue
    }
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line
    const equalsIndex = normalized.indexOf("=")
    if (equalsIndex <= 0) {
      continue
    }
    const key = normalized.slice(0, equalsIndex).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) {
      continue
    }
    process.env[key] = parseEnvValue(normalized.slice(equalsIndex + 1))
  }
}

export async function loadReleaseEnv() {
  const explicitEnvFile = readArg("--env-file")
  const candidates = explicitEnvFile
    ? [path.resolve(explicitEnvFile)]
    : DEFAULT_ENV_FILES.map((fileName) => path.join(repoRoot, fileName))
  const loaded = []

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      await loadEnvFile(candidate)
      loaded.push(candidate)
    }
  }

  return loaded
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: false,
    })

    let stdout = ""
    let stderr = ""
    if (options.capture) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString("utf8")
      })
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString("utf8")
      })
    }

    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(stderr.trim() || `${command} exited with ${String(code)}`))
    })
  })
}

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function findExecutable(name) {
  const pathEnv = process.env.PATH ?? ""
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    if (await exists(candidate)) {
      return candidate
    }
  }
  return null
}

async function resolveCoscli() {
  if (process.env.COSCLI_PATH) {
    return process.env.COSCLI_PATH
  }

  const existing = await findExecutable("coscli")
  if (existing) {
    return existing
  }

  const downloadUrl = COSCLI_DOWNLOADS[`${process.platform}-${process.arch}`]
  if (!downloadUrl) {
    throw new Error("COSCLI is not installed. Set COSCLI_PATH or install coscli for this platform.")
  }

  const binDir = path.join(os.tmpdir(), "synapse-coscli")
  const binPath = path.join(binDir, "coscli")
  await mkdir(binDir, { recursive: true })
  await run("curl", ["--fail", "--silent", "--show-error", "--location", "--output", binPath, downloadUrl])
  await chmod(binPath, 0o755)
  return binPath
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

async function writeCosConfig({ bucket, region, endpoint }) {
  const configPath = path.join(os.tmpdir(), `synapse-cos-${Date.now()}.yaml`)
  await writeFile(configPath, [
    "cos:",
    "  base:",
    `    secretid: ${requireEnv("TENCENT_CLOUD_SECRET_ID")}`,
    `    secretkey: ${requireEnv("TENCENT_CLOUD_SECRET_KEY")}`,
    '    sessiontoken: ""',
    "    protocol: https",
    "  buckets:",
    `    - name: ${bucket}`,
    "      alias: release",
    `      region: ${region}`,
    `      endpoint: ${endpoint}`,
    "      ofs: false",
    "",
  ].join("\n"), "utf8")
  return configPath
}

function uploadCommands({ outDir, version }) {
  const versionPrefix = `v${version}`
  return [
    { from: path.join(outDir, versionPrefix) + path.sep, to: `cos://release/${versionPrefix}/`, recursive: true },
    { from: path.join(outDir, "latest-mac.yml"), to: "cos://release/latest-mac.yml", recursive: false },
    { from: path.join(outDir, "manifest.json"), to: `cos://release/${versionPrefix}/manifest-mac.json`, recursive: false },
    { from: path.join(outDir, "release-body.md"), to: `cos://release/${versionPrefix}/release-body-mac.md`, recursive: false },
  ]
}

async function uploadWithCoscli({ coscli, cosConfig, outDir, version }) {
  const flags = ["--part-size", "16", "--thread-num", "16", "--routines", "4", "--err-retry-num", "3", "--err-retry-interval", "3"]
  for (const command of uploadCommands({ outDir, version })) {
    const args = ["cp", command.from, command.to, "-c", cosConfig, ...flags]
    if (command.recursive) {
      args.splice(3, 0, "-r")
    }
    await run(coscli, args)
  }
}

async function refreshCdn(cdnBaseUrl) {
  const tccli = await findExecutable("tccli")
  if (!tccli) {
    throw new Error("tccli is not installed. Install it with `python -m pip install --user tccli` or pass --skip-cdn-refresh.")
  }
  const url = `${cdnBaseUrl}latest-mac.yml`
  await run(tccli, ["cdn", "PurgeUrlsCache", "--Urls", JSON.stringify([url]), "--Area", "mainland"], {
    env: {
      ...process.env,
      TENCENTCLOUD_SECRET_ID: requireEnv("TENCENT_CLOUD_SECRET_ID"),
      TENCENTCLOUD_SECRET_KEY: requireEnv("TENCENT_CLOUD_SECRET_KEY"),
      TENCENTCLOUD_REGION: CDN_REFRESH_REGION,
    },
  })
}

async function verifyCdn(cdnBaseUrl, outDir, version) {
  await run("curl", ["--fail", "--silent", "--show-error", "--location", "--head", `${cdnBaseUrl}latest-mac.yml`])
  const manifest = JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8")).assetUrls
  for (const url of manifest.filter((item) => item.includes(`/v${version}/`) && (item.endsWith(".dmg") || item.endsWith(".zip")))) {
    await run("curl", ["--fail", "--silent", "--show-error", "--location", "--head", url])
  }
}

export async function publishMacRelease() {
  const loadedEnvFiles = await loadReleaseEnv()
  const version = readArg("--version") ?? await readPackageVersion()
  const artifactsDir = path.resolve(readArg("--artifacts-dir") ?? path.join(packageRoot, "release"))
  const outDir = path.resolve(readArg("--out-dir") ?? path.join(repoRoot, "cdn-release-mac"))
  const cdnBaseUrl = normalizeCdnBaseUrl(readArg("--cdn-base-url") ?? process.env.TENCENT_CLOUD_CDN_BASE_URL ?? DEFAULT_CDN_BASE_URL)
  const bucket = process.env.TENCENT_CLOUD_COS_BUCKET ?? DEFAULT_COS_BUCKET
  const region = process.env.TENCENT_CLOUD_COS_REGION ?? DEFAULT_COS_REGION
  const endpoint = process.env.TENCENT_CLOUD_COS_ENDPOINT ?? DEFAULT_COS_ENDPOINT

  await prepareReleaseArtifacts({
    artifactsDir,
    outDir,
    version,
    cdnBaseUrl,
    platform: "mac",
  })

  const commands = uploadCommands({ outDir, version })
  if (hasArg("--dry-run")) {
    process.stdout.write([
      ...loadedEnvFiles.map((filePath) => `Loaded env file: ${filePath}`),
      `Prepared mac release v${version}`,
      ...commands.map((command) => `${command.from} -> ${command.to}`),
      ...(hasArg("--skip-cos-prune") ? [] : ["Would prune old COS release versions after publish"]),
      "",
    ].join("\n"))
    return
  }

  const coscli = await resolveCoscli()
  const cosConfig = await writeCosConfig({ bucket, region, endpoint })
  await uploadWithCoscli({ coscli, cosConfig, outDir, version })

  if (!hasArg("--skip-cdn-refresh")) {
    await refreshCdn(cdnBaseUrl)
  }
  if (!hasArg("--skip-cdn-verify")) {
    await verifyCdn(cdnBaseUrl, outDir, version)
  }
  if (!hasArg("--skip-cos-prune")) {
    await pruneCosReleaseVersions({ coscli, cosConfig })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishMacRelease().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
