#!/usr/bin/env node
/**
 * Phase 0.6 — Hard-constraint enforcement script.
 * SPEC §1.
 *
 * Walks the targeted directories with node:fs and runs each pattern via the
 * standard regex engine. We deliberately don't shell out to ripgrep so this
 * script works in any CI environment (rg isn't always installed).
 *
 * The full ESLint setup (no-restricted-imports rule per SPEC §9) is a
 * follow-up — Phase 0 doesn't pull in ESLint just to enforce one rule when
 * a self-contained walker does the same job.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(__dirname, "..")

const checks = [
  {
    description: "No new export default new XxxService() singletons in runtime/bootstrap",
    pattern: /^\s*export\s+default\s+new\s+\w+Service\(/m,
    roots: ["electron/runtime", "electron/bootstrap", "src/runtime"],
    excludeDirs: ["__tests__"],
  },
  {
    description: "No bare ipcMain.handle/on outside runtime/ipc",
    pattern: /ipcMain\.(handle|on)\(/,
    roots: ["electron", "src/runtime"],
    excludeDirs: ["runtime/ipc", "__tests__"],
    allowFiles: ["electron/ipc/validated-ipc.ts"],
    skipDocComments: true,
  },
  {
    description: "No bare webContents.send outside runtime/event-bus and runtime/window",
    pattern: /webContents\.send\(/,
    roots: ["electron", "src/runtime"],
    excludeDirs: ["runtime/event-bus", "runtime/window", "__tests__"],
    skipDocComments: true,
  },
  {
    description: "No bare http/net/https.createServer outside runtime/network",
    pattern: /\b(?:http|net|https)\.createServer\(|\bcreateServer\(/,
    roots: ["electron", "src/runtime"],
    excludeDirs: ["runtime/network", "__tests__"],
    allowFiles: [
      "electron/database/http-server.ts",
      "electron/database/mcp-server.ts",
    ],
    skipDocComments: true,
  },
  {
    description: "No empty catch blocks in runtime/bootstrap",
    pattern: /catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}/,
    roots: ["electron/runtime", "electron/bootstrap", "src/runtime"],
    excludeDirs: ["__tests__"],
  },
  {
    description: "No bare fs.writeFile in bootstrap or src/runtime",
    pattern: /fs\.(writeFile|writeFileSync)\(/,
    roots: ["electron/bootstrap", "src/runtime"],
    excludeDirs: ["__tests__"],
  },
]

const TS_EXT = /\.(ts|tsx|mts|cts)$/

function listFiles(root) {
  const absRoot = path.resolve(desktopRoot, root)
  const out = []
  let stack = []
  try {
    if (statSync(absRoot).isDirectory()) {
      stack.push(absRoot)
    }
  } catch {
    return out
  }
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile() && TS_EXT.test(entry.name)) {
        out.push(full)
      }
    }
  }
  return out
}

function isExcluded(file, excludeDirs) {
  return excludeDirs.some((segment) => file.includes(`${path.sep}${segment}${path.sep}`)
    || file.includes(`/${segment}/`))
}

function isAllowed(file, allowFiles) {
  return (allowFiles ?? []).includes(file.split(path.sep).join("/"))
}

function lineMatches(line, pattern, skipDocComments) {
  if (skipDocComments && /^\s*\*/.test(line)) return false
  return pattern.test(line)
}

let failed = 0

for (const check of checks) {
  const offenders = []
  for (const root of check.roots) {
    for (const file of listFiles(root)) {
      const relFile = path.relative(desktopRoot, file)
      if (isExcluded(relFile, check.excludeDirs ?? [])) continue
      let content
      try {
        content = readFileSync(file, "utf8")
      } catch {
        continue
      }
      const lines = content.split("\n")
      for (let i = 0; i < lines.length; i++) {
        if (isAllowed(relFile, check.allowFiles)) break
        const line = lines[i]
        if (lineMatches(line, check.pattern, check.skipDocComments ?? false)) {
          offenders.push(`${relFile}:${i + 1}: ${line.trim()}`)
          break
        }
      }
    }
  }
  if (offenders.length > 0) {
    console.error(`✗ ${check.description}`)
    for (const o of offenders) console.error(`  ${o}`)
    failed++
  }
}

if (failed > 0) {
  console.error(`\n${failed} hard-constraint check(s) failed.`)
  process.exit(1)
}
console.log("All hard-constraint checks passed.")
