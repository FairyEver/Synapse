import type { Stats } from "node:fs"

import { AgentReferenceActionFailure } from "./failure"
import { isExpectedFilesystemUnavailableError } from "./filesystem-error"

export type AgentReferenceSnapshot = {
  readonly stats: Stats
}

export type AgentReferenceParentSnapshot = {
  readonly surfacePath: string
  readonly realPath: string
}

type SnapshotIo = {
  lstat(targetPath: string, stage: string): Promise<Stats>
  realpath(targetPath: string, stage: string): Promise<string>
}

export function isOpenableReference(stats: Stats): boolean {
  return stats.isFile() || stats.isDirectory()
}

export function isRevealableReference(stats: Stats): boolean {
  return isOpenableReference(stats) || stats.isSymbolicLink()
}

export function isSameFilesystemIdentity(before: Stats, after: Stats): boolean {
  return before.dev === after.dev
    && before.ino === after.ino
    && before.mode === after.mode
}

export function isSamePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  return platform === "win32"
    ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right
}

export function isRedirectingLeaf(options: {
  readonly surfaceStats: Stats
  readonly realStats: Stats
  readonly realPath: string
  readonly expectedRealPath: string
  readonly platform: NodeJS.Platform
}): boolean {
  if (isSamePath(options.realPath, options.expectedRealPath, options.platform)) return false
  return !isSameFilesystemIdentity(options.surfaceStats, options.realStats)
}

export async function revalidateOpenReferenceTarget(options: {
  readonly surfacePath: string
  readonly surface: AgentReferenceSnapshot
  readonly realPath: string
  readonly realStats: Stats
  readonly parentSnapshot?: AgentReferenceParentSnapshot
  readonly platform: NodeJS.Platform
  readonly io: SnapshotIo
}): Promise<void> {
  try {
    const currentSurface = await options.io.lstat(options.surfacePath, "recheck_surface")
    const currentRealPath = await options.io.realpath(options.surfacePath, "recheck_realpath")
    const currentRealStats = await options.io.lstat(currentRealPath, "recheck_real")
    const currentParentPath = options.parentSnapshot
      ? await options.io.realpath(
          options.parentSnapshot.surfacePath,
          "recheck_surface_parent_realpath",
        )
      : undefined
    if (
      currentSurface.isSymbolicLink()
      || !isSameFilesystemIdentity(options.surface.stats, currentSurface)
      || !isSamePath(options.realPath, currentRealPath, options.platform)
      || !isSameFilesystemIdentity(options.realStats, currentRealStats)
      || !isOpenableReference(currentRealStats)
      || (options.parentSnapshot && (
        !currentParentPath
        || !isSamePath(options.parentSnapshot.realPath, currentParentPath, options.platform)
      ))
    ) {
      throw new AgentReferenceActionFailure("target_changed", "recheck")
    }
  } catch (error) {
    if (error instanceof AgentReferenceActionFailure) throw error
    if (isExpectedFilesystemUnavailableError(error)) {
      throw new AgentReferenceActionFailure("target_changed", "recheck")
    }
    throw error
  }
}

export async function revalidateRevealReferenceTarget(options: {
  readonly surfacePath: string
  readonly surface: AgentReferenceSnapshot
  readonly parentPath: string
  readonly actualParentPath: string
  readonly parentStats: Stats
  readonly platform: NodeJS.Platform
  readonly io: SnapshotIo
}): Promise<void> {
  try {
    const currentSurface = await options.io.lstat(options.surfacePath, "recheck_surface")
    const currentParent = await options.io.realpath(options.parentPath, "recheck_parent_realpath")
    const currentParentStats = await options.io.lstat(currentParent, "recheck_parent")
    if (
      !isRevealableReference(currentSurface)
      || !isSameFilesystemIdentity(options.surface.stats, currentSurface)
      || !isSamePath(options.actualParentPath, currentParent, options.platform)
      || !isSameFilesystemIdentity(options.parentStats, currentParentStats)
      || !currentParentStats.isDirectory()
    ) {
      throw new AgentReferenceActionFailure("target_changed", "recheck")
    }
  } catch (error) {
    if (error instanceof AgentReferenceActionFailure) throw error
    if (isExpectedFilesystemUnavailableError(error)) {
      throw new AgentReferenceActionFailure("target_changed", "recheck")
    }
    throw error
  }
}
