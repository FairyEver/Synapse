import { createHash } from "node:crypto"
import type { DriveSyncAlignmentPreview } from "@synapse/shared" with { "resolution-mode": "import" }

export interface AlignmentEntry {
  readonly relativePath: string
  readonly kind: "file" | "folder"
  readonly hash: string | null
  readonly remoteId?: string
  readonly remoteVersionId?: string | null
  readonly stamp?: string
}

/** Initial authority is an explicit mirror of the included tree, never a two-history merge. */
export function planDriveSyncAlignment(local: readonly AlignmentEntry[], remote: readonly AlignmentEntry[], authority: "local" | "remote"): DriveSyncAlignmentPreview {
  const source = authority === "local" ? local : remote
  const target = authority === "local" ? remote : local
  const targetByPath = new Map(target.map((entry) => [entry.relativePath, entry]))
  const sourceByPath = new Map(source.map((entry) => [entry.relativePath, entry]))
  const changes: DriveSyncAlignmentPreview["changes"][number][] = []
  let unchanged = 0
  for (const entry of [...source].sort((a, b) => a.relativePath.split("/").length - b.relativePath.split("/").length || a.relativePath.localeCompare(b.relativePath))) {
    const other = targetByPath.get(entry.relativePath)
    // Replacing a folder can destroy excluded descendants. Require resolving type collisions first.
    if (other && entry.kind !== other.kind) throw new Error(`类型不一致，请先改名或排除：${entry.relativePath || "同步根目录"}`)
    if (other && (entry.kind === "folder" || entry.hash === other.hash)) {
      unchanged += 1
      continue
    }
    changes.push({ relativePath: entry.relativePath, kind: entry.kind, action: authority === "local" ? "upload" : "download" })
  }
  // Delete leaves before parents. The caller checks excluded descendants before removing a folder.
  for (const entry of [...target].sort((a, b) => b.relativePath.split("/").length - a.relativePath.split("/").length)) {
    if (!sourceByPath.has(entry.relativePath)) changes.push({ relativePath: entry.relativePath, kind: entry.kind, action: authority === "local" ? "delete_remote" : "delete_local" })
  }
  return { changes, unchanged }
}

export function alignmentFingerprint(config: unknown, local: readonly AlignmentEntry[], remote: readonly AlignmentEntry[]): string {
  const sorted = (entries: readonly AlignmentEntry[]) => [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return createHash("sha256").update(JSON.stringify([config, sorted(local), sorted(remote)])).digest("hex")
}
