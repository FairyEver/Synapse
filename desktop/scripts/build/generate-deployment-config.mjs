import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  DESKTOP_CLIENT_ID,
  DESKTOP_PKCE_CHALLENGE_METHOD,
  DESKTOP_REDIRECT_URI,
  buildApiBaseUrl,
  normalizePublicAppUrl,
} from "@synapse/shared"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(scriptDir, "../..")
const defaultOutputPath = path.join(desktopRoot, "electron", "generated", "deployment-config.generated.ts")
const defaultRendererOutputPath = path.join(desktopRoot, "src", "generated", "deployment-config.generated.ts")
const developmentPublicAppUrl = "http://localhost:3000"
const ciPublicAppUrl = "https://synapse.invalid"

function parseArgs(args) {
  const options = {
    outputPath: defaultOutputPath,
    rendererOutputPath: defaultRendererOutputPath,
    requirePublicAppUrl: process.env.SYNAPSE_DESKTOP_REQUIRE_PUBLIC_APP_URL === "1",
  }
  let rendererOutputConfigured = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--output") {
      const value = args[index + 1]
      if (!value) throw new Error("--output requires a path")
      options.outputPath = path.resolve(desktopRoot, value)
      if (!rendererOutputConfigured) {
        options.rendererOutputPath = null
      }
      index += 1
      continue
    }
    if (arg === "--renderer-output") {
      const value = args[index + 1]
      if (!value) throw new Error("--renderer-output requires a path")
      options.rendererOutputPath = path.resolve(desktopRoot, value)
      rendererOutputConfigured = true
      index += 1
      continue
    }
    if (arg === "--require-public-app-url") {
      options.requirePublicAppUrl = true
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

/**
 * Reads the public app URL out of a config this script generated earlier.
 *
 * The generator runs from ordinary rebuilds and test runs, so a machine that already has a
 * deployment config must not have it repointed just because that particular shell happens to
 * lack the variable. The previous value is the source of truth for "the environment this
 * checkout is already configured for".
 */
async function readExistingPublicAppUrl(outputPaths) {
  for (const outputPath of outputPaths) {
    let contents
    try {
      contents = await readFile(outputPath, "utf8")
    } catch {
      continue
    }
    const match = /publicAppUrl:\s*("(?:[^"\\]|\\.)*")/u.exec(contents)
    if (!match) continue
    try {
      const value = JSON.parse(match[1])
      if (typeof value !== "string") continue
      return normalizeAndValidatePublicAppUrl(value)
    } catch {
      continue
    }
  }
  return null
}

function resolvePublicAppUrl(env, requirePublicAppUrl, existingPublicAppUrl) {
  const configured = env.SYNAPSE_DESKTOP_PUBLIC_APP_URL?.trim()
  if (configured) return { publicAppUrl: normalizeAndValidatePublicAppUrl(configured), source: "environment" }
  if (requirePublicAppUrl) {
    throw new Error("SYNAPSE_DESKTOP_PUBLIC_APP_URL is required for desktop release builds.")
  }
  if (env.CI) return { publicAppUrl: ciPublicAppUrl, source: "ci" }
  if (existingPublicAppUrl) return { publicAppUrl: existingPublicAppUrl, source: "existing" }
  return { publicAppUrl: developmentPublicAppUrl, source: "development" }
}

/** Never change the environment quietly: say what was kept, or why localhost was assumed. */
function reportResolution({ publicAppUrl, source }) {
  if (source === "existing") {
    console.log(
      `SYNAPSE_DESKTOP_PUBLIC_APP_URL is not set; keeping the existing deployment config (${publicAppUrl}).\n`
      + "Set SYNAPSE_DESKTOP_PUBLIC_APP_URL explicitly to point the desktop app at another environment.",
    )
    return
  }
  if (source !== "development") return
  console.warn([
    "",
    "SYNAPSE_DESKTOP_PUBLIC_APP_URL is not set and no deployment config exists yet.",
    `Falling back to ${developmentPublicAppUrl}.`,
    "The desktop app will only reach locally running services and will not be reachable from other devices.",
    "Set the variable explicitly, or start the stack with `pnpm dev:prod`:",
    `  SYNAPSE_DESKTOP_PUBLIC_APP_URL=https://synapse.d2.pub pnpm generate:deployment-config`,
    "",
  ].join("\n"))
}

function normalizeAndValidatePublicAppUrl(value) {
  const normalized = normalizePublicAppUrl(value)
  let parsed
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error("SYNAPSE_DESKTOP_PUBLIC_APP_URL must be a valid http(s) URL.")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("SYNAPSE_DESKTOP_PUBLIC_APP_URL must use http or https.")
  }
  if (parsed.pathname.replace(/\/+$/u, "") === "/api") {
    throw new Error("SYNAPSE_DESKTOP_PUBLIC_APP_URL must be the public app root, not the /api URL.")
  }
  return normalized
}

function renderConfig(publicAppUrl) {
  const apiBaseUrl = buildApiBaseUrl(publicAppUrl)
  return `// Generated by scripts/build/generate-deployment-config.mjs. Do not edit.

export const SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG = {
  publicAppUrl: ${JSON.stringify(publicAppUrl)},
  apiBaseUrl: ${JSON.stringify(apiBaseUrl)},
  desktopClientId: ${JSON.stringify(DESKTOP_CLIENT_ID)},
  desktopRedirectUri: ${JSON.stringify(DESKTOP_REDIRECT_URI)},
  desktopPkceChallengeMethod: ${JSON.stringify(DESKTOP_PKCE_CHALLENGE_METHOD)},
} as const
`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const outputPaths = Array.from(new Set([options.outputPath, options.rendererOutputPath].filter(Boolean)))
  const existingPublicAppUrl = await readExistingPublicAppUrl(outputPaths)
  const resolved = resolvePublicAppUrl(process.env, options.requirePublicAppUrl, existingPublicAppUrl)
  const output = renderConfig(resolved.publicAppUrl)
  await Promise.all(outputPaths.map(async (outputPath) => {
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, output, "utf8")
  }))
  console.log(`generated ${outputPaths.map((outputPath) => path.relative(process.cwd(), outputPath)).join(", ")}`)
  reportResolution(resolved)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
