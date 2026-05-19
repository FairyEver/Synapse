import fs from "node:fs"
import path from "node:path"

export interface UsageFileFingerprint {
  readonly filePath: string
  readonly size: number
  readonly mtimeMs: number
}

function collectJsonlFilesFromDir(dir: string, out: string[], maxDepth: number): void {
  if (maxDepth <= 0) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectJsonlFilesFromDir(fullPath, out, maxDepth - 1)
      continue
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(fullPath)
    }
  }
}

export function collectJsonlFiles(roots: string[], maxDepth = 8): string[] {
  const files: string[] = []
  for (const root of roots) {
    collectJsonlFilesFromDir(root, files, maxDepth)
  }
  return [...new Set(files)].sort()
}

export function fingerprintFile(filePath: string): UsageFileFingerprint {
  const stat = fs.statSync(filePath)
  return {
    filePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  }
}
