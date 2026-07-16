import { lstat, readFile } from "node:fs/promises"
import path from "node:path"

import { SKILL_UNINSTALL_MAX_METADATA_BYTES } from "../../../config"

export type SynapseContentIdReadResult =
  | { readonly status: "absent" | "too-large" | "unreadable" }
  | { readonly status: "readable"; readonly contentId?: string }

export async function readSynapseContentId(targetPath: string): Promise<SynapseContentIdReadResult> {
  const metadataPath = path.join(targetPath, ".synapse.json")
  let stats
  try {
    stats = await lstat(metadataPath)
  } catch (error) {
    return { status: isMissing(error) ? "absent" : "unreadable" }
  }
  if (!stats.isFile() || stats.isSymbolicLink()) return { status: "absent" }
  if (stats.size > SKILL_UNINSTALL_MAX_METADATA_BYTES) return { status: "too-large" }
  try {
    const content = await readFile(metadataPath, "utf8")
    if (Buffer.byteLength(content, "utf8") > SKILL_UNINSTALL_MAX_METADATA_BYTES) {
      return { status: "too-large" }
    }
    const metadata = JSON.parse(content) as { id?: unknown }
    const contentId = typeof metadata.id === "string" ? metadata.id.trim() : ""
    return { status: "readable", ...(contentId ? { contentId } : {}) }
  } catch {
    return { status: "unreadable" }
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
