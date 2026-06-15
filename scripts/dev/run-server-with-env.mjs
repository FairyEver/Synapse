import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runPnpm } from "./process-utils.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "../..")
const envPath = path.join(repoRoot, "server/.env.local")

function parseEnvFile(raw) {
  const env = {}

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue

    const normalizedLine = line.startsWith("export ") ? line.slice(7).trimStart() : line
    const separatorIndex = normalizedLine.indexOf("=")
    if (separatorIndex <= 0) continue

    const key = normalizedLine.slice(0, separatorIndex).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue

    env[key] = parseEnvValue(normalizedLine.slice(separatorIndex + 1).trim())
  }

  return env
}

function parseEnvValue(value) {
  if (value.startsWith("\"") && value.endsWith("\"")) {
    return value
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\")
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
  }

  return value.replace(/\s+#.*$/u, "")
}

async function loadServerEnv() {
  try {
    return parseEnvFile(await readFile(envPath, "utf8"))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {}
    }
    throw error
  }
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error("[run-server-with-env] Missing pnpm arguments.")
  process.exit(1)
}

try {
  const result = await runPnpm(args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...await loadServerEnv(),
    },
  })
  if (result.signal) process.exit(1)
  process.exit(result.code)
} catch (error) {
  console.error("[run-server-with-env] Failed to start pnpm.", error)
  process.exit(1)
}
