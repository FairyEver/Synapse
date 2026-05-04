import fs from "node:fs"
import path from "node:path"
import { CLIENT_DEFS, resolveClientBasePath, getExtraScanPaths } from "./clients"
import type { ClientDef, ScanResult } from "./parsers/types"

function matchesPattern(fileName: string, pattern: string): boolean {
  const patterns = pattern.split("|")
  return patterns.some((p) => {
    if (p === fileName) return true
    if (p.startsWith("*")) return fileName.endsWith(p.slice(1))
    if (p.endsWith("*")) return fileName.startsWith(p.slice(0, -1))
    if (p.includes("*")) {
      const [prefix, suffix] = p.split("*", 2)
      return fileName.startsWith(prefix) && fileName.endsWith(suffix)
    }
    return false
  })
}

function collectFiles(dir: string, pattern: string, result: string[], maxDepth = 10): void {
  if (maxDepth <= 0) return
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        collectFiles(full, pattern, result, maxDepth - 1)
      } else if (matchesPattern(entry.name, pattern)) {
        result.push(full)
      }
    }
  } catch {
    // directory doesn't exist or not readable
  }
}

export function scanAllClients(): ScanResult[] {
  const results: ScanResult[] = []

  for (const def of CLIENT_DEFS) {
    if (!def.parseLocal) continue

    const files: string[] = []
    const seen = new Set<string>()

    const basePath = resolveClientBasePath(def)
    collectFiles(basePath, def.filePattern, files)

    const extraPaths = getExtraScanPaths(def)
    for (const extra of extraPaths) {
      collectFiles(extra, def.filePattern, files)
    }

    const uniqueFiles: string[] = []
    for (const f of files) {
      try {
        const resolved = fs.realpathSync(f)
        if (!seen.has(resolved)) {
          seen.add(resolved)
          uniqueFiles.push(f)
        }
      } catch {
        if (!seen.has(f)) {
          seen.add(f)
          uniqueFiles.push(f)
        }
      }
    }

    if (uniqueFiles.length > 0) {
      results.push({ clientId: def.id, files: uniqueFiles })
    }
  }

  return results
}

export function getClientDef(clientId: string): ClientDef | undefined {
  return CLIENT_DEFS.find((d) => d.id === clientId)
}
