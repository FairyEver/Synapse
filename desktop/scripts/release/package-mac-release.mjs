#!/usr/bin/env node
import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { loadReleaseEnv } from "./publish-mac-release.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptDir, "../..")

function hasArg(name) {
  return process.argv.includes(name)
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? packageRoot,
      env: options.env ?? process.env,
      stdio: "inherit",
      shell: false,
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} exited with ${String(code)}`))
    })
  })
}

function requireDesktopPublicAppUrl() {
  const value = process.env.SYNAPSE_DESKTOP_PUBLIC_APP_URL?.trim()
  if (!value) {
    throw new Error("Missing required environment variable: SYNAPSE_DESKTOP_PUBLIC_APP_URL")
  }

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error("SYNAPSE_DESKTOP_PUBLIC_APP_URL must be a valid http(s) URL.")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("SYNAPSE_DESKTOP_PUBLIC_APP_URL must use http or https.")
  }
  if (parsed.pathname.replace(/\/+$/u, "") === "/api") {
    throw new Error("SYNAPSE_DESKTOP_PUBLIC_APP_URL must be the public app root, not the /api URL.")
  }
  return value.replace(/\/+$/u, "")
}

export async function packageMacRelease() {
  const loadedEnvFiles = await loadReleaseEnv()
  const publicAppUrl = requireDesktopPublicAppUrl()
  process.env.SYNAPSE_DESKTOP_REQUIRE_PUBLIC_APP_URL = "1"

  if (hasArg("--check") || hasArg("--dry-run")) {
    process.stdout.write([
      ...loadedEnvFiles.map((filePath) => `Loaded env file: ${filePath}`),
      `Desktop public app URL: ${publicAppUrl}`,
      hasArg("--check") ? "Release package preflight passed." : "Would run: pnpm package:mac && pnpm check:packaged-asar",
      "",
    ].join("\n"))
    return
  }

  await run("pnpm", ["package:mac"])
  await run("pnpm", ["check:packaged-asar"])
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  packageMacRelease().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
