import { MOBILE_WORKSPACE_FILES_LIMITS as L } from "@synapse/shared/mobile-live-constants"
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { open } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { checkedNode, decodeText, fileIdentity, MobileWorkspaceFilesError, throwIfAborted } from "./mobile-workspace-files-paths"

/** Desktop construction facts only. Never populated from an intent or repository config. */
export interface MobileFilesGitConfigurationLocations { homeDirectory: string; xdgConfigHome?: string; unsupportedConfigurationOverride?: boolean }

export function standardGitConfigurationLocations(environment: Readonly<NodeJS.ProcessEnv> = process.env): MobileFilesGitConfigurationLocations {
  const count = environment.GIT_CONFIG_COUNT
  const unsupportedConfigurationOverride = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG"].some(key => !!environment[key]) || count !== undefined && !/^0+$/.test(count)
  return { homeDirectory: os.homedir(), ...(environment.XDG_CONFIG_HOME ? { xdgConfigHome: environment.XDG_CONFIG_HOME } : {}), ...(unsupportedConfigurationOverride ? { unsupportedConfigurationOverride: true } : {}) }
}

export function standardGitConfigurationPaths(locations: MobileFilesGitConfigurationLocations): string[] {
  if (locations.unsupportedConfigurationOverride) throw new MobileWorkspaceFilesError("git_unavailable")
  const xdg = locations.xdgConfigHome ?? path.join(locations.homeDirectory, ".config")
  if ([locations.homeDirectory, xdg].some(value => !path.isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value) || /^\\\\|^\/\//.test(value))) throw new MobileWorkspaceFilesError("git_unavailable")
  return [path.join(xdg, "git", "config"), path.join(locations.homeDirectory, ".gitconfig")]
}

const absent = (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"

/** Only bounded repository pointers or configuration; authorize before existence checks. */
export async function readGitMetadataSnapshot(target: string, authorize: (target: string) => Promise<void>, signal: AbortSignal, maxBytes: number): Promise<{ text: string; version: string; sizeBytes: number } | null> {
  if (maxBytes !== L.maxPathBytes && maxBytes !== L.maxGitStderrBytes) throw new MobileWorkspaceFilesError("invalid_request")
  throwIfAborted(signal)
  await authorize(target)
  throwIfAborted(signal)
  const root = path.parse(target).root, relative = path.relative(root, target)
  let before
  try { before = await checkedNode(root, relative) }
  catch (error) { if (absent(error)) return null; throw error }
  throwIfAborted(signal)
  if (before.kind !== "file") throw new MobileWorkspaceFilesError("git_unavailable")
  if (before.stats.size > maxBytes) throw new MobileWorkspaceFilesError("limit_exceeded")
  const descriptor = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    throwIfAborted(signal)
    const descriptorBefore = await descriptor.stat()
    throwIfAborted(signal)
    if (!descriptorBefore.isFile() || fileIdentity(descriptorBefore) !== before.identity) throw new MobileWorkspaceFilesError("content_stale")
    const buffer = Buffer.alloc(maxBytes + 1)
    let size = 0
    while (size < buffer.length) {
      throwIfAborted(signal)
      const read = await descriptor.read(buffer, size, buffer.length - size, null)
      if (!read.bytesRead) break
      size += read.bytesRead
    }
    throwIfAborted(signal)
    if (size > maxBytes) throw new MobileWorkspaceFilesError("limit_exceeded")
    const after = await checkedNode(root, relative)
    if (fileIdentity(await descriptor.stat()) !== before.identity || after.identity !== before.identity || before.ancestors.join("|") !== after.ancestors.join("|")) throw new MobileWorkspaceFilesError("content_stale")
    throwIfAborted(signal)
    const bytes = buffer.subarray(0, size)
    let text
    try { text = decodeText(bytes) }
    catch (error) {
      if (error instanceof MobileWorkspaceFilesError && ["binary", "unsupported_encoding"].includes(error.code)) throw new MobileWorkspaceFilesError("git_unavailable")
      throw error
    }
    return { text, version: `${target}:${before.identity}:${createHash("sha256").update(bytes).digest("hex")}`, sizeBytes: size }
  } finally { await descriptor.close() }
}

/** Standard configuration snapshots retain an explicit absence fingerprint. */
export async function readGitConfigurationSnapshot(target: string, authorize: (target: string) => Promise<void>, signal: AbortSignal): Promise<{ text: string; version: string }> {
  return await readGitMetadataSnapshot(target, authorize, signal, L.maxGitStderrBytes) ?? { text: "", version: `${target}:absent` }
}
