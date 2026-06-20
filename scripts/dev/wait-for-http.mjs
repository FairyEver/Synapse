import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"

const currentFilePath = fileURLToPath(import.meta.url)

function parsePositiveInteger(value, optionName) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`)
  }

  return parsed
}

function parseWaitForHttpArgs(args) {
  const [url, ...rest] = args
  if (!url) {
    throw new Error("Usage: node scripts/dev/wait-for-http.mjs <url> [--timeout-ms <ms>] [--interval-ms <ms>]")
  }

  const options = {
    url,
    timeoutMs: 60_000,
    intervalMs: 500,
  }

  for (let index = 0; index < rest.length; index += 1) {
    const optionName = rest[index]
    const optionValue = rest[index + 1]

    if (optionName === "--timeout-ms") {
      options.timeoutMs = parsePositiveInteger(optionValue, optionName)
      index += 1
      continue
    }

    if (optionName === "--interval-ms") {
      options.intervalMs = parsePositiveInteger(optionValue, optionName)
      index += 1
      continue
    }

    throw new Error(`Unknown option: ${optionName}`)
  }

  return options
}

async function fetchOnce(url, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function waitForHttp(options) {
  const startedAt = Date.now()
  const deadline = startedAt + options.timeoutMs
  let lastError = "not checked yet"

  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now())
    const requestTimeoutMs = Math.min(options.intervalMs, remainingMs)

    try {
      const response = await fetchOnce(options.url, requestTimeoutMs)
      if (response.ok) {
        return { elapsedMs: Date.now() - startedAt, status: response.status }
      }

      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await delay(Math.min(options.intervalMs, Math.max(1, deadline - Date.now())))
  }

  throw new Error(`Timed out waiting for ${options.url}: ${lastError}`)
}

async function main() {
  const options = parseWaitForHttpArgs(process.argv.slice(2))
  console.log(`Waiting for ${options.url}`)
  const result = await waitForHttp(options)
  console.log(`Ready ${options.url} (${result.status}, ${result.elapsedMs}ms)`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

export {
  parseWaitForHttpArgs,
  waitForHttp,
}
