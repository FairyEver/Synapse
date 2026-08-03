import { lstat, readFile } from "node:fs/promises"
import path from "node:path"
import type { DriveSyncBindingPreviewDto, DriveSyncExcludeRulesDto, DriveSyncInitialDirection } from "@synapse/shared" with { "resolution-mode": "import" }
import type { DriveSyncBindingEntryV1 } from "../runtime/data-repo"
import { createDefaultDriveSyncExcludeRules, parseGitignoreForDriveSync } from "./drive-sync-excludes"
import { formatDriveSyncSkippedLocalEntries, inspectDriveSyncLocalPath, scanDriveSyncLocalTreeDetailed } from "./drive-sync-local-snapshot"
import { localPathIdentitiesOverlap, normalizeLocalPath } from "./drive-sync-paths"

export async function previewDriveSyncBinding(input: {
  readonly driveItemId: string
  readonly driveItemName: string
  readonly kind: "file" | "folder"
  readonly localPath: string
  readonly remoteExists: boolean
  readonly remoteSize?: string | null
  readonly directionHint?: DriveSyncInitialDirection | null
  readonly activeBindings: readonly DriveSyncBindingEntryV1[]
  readonly importGitignore?: boolean
  readonly useDefaultExcludes?: boolean
  readonly excludeRules?: readonly string[]
}): Promise<DriveSyncBindingPreviewDto> {
  const localPath = normalizeLocalPath(input.localPath)
  const rules = createDefaultDriveSyncExcludeRules()
  const local = await inspectDriveSyncLocalPath(localPath)
  const duplicateReason = await findDuplicateBindingReason(localPath, input.driveItemId, input.activeBindings)
  const detectedGitignoreRules = local.kind === "folder"
    ? await readDriveSyncGitignoreRules(localPath)
    : []
  const importedGitignoreRules = input.importGitignore ? detectedGitignoreRules : []
  if (duplicateReason) {
    return blocked(localPath, local.kind, local.empty, duplicateReason, importedGitignoreRules, detectedGitignoreRules, input.useDefaultExcludes)
  }
  const skippedLocalFolderReason = input.kind === "folder" && local.kind === "folder" && shouldRequireCompleteLocalFolder(input)
    ? await findSkippedLocalFolderReason(localPath, input.excludeRules ?? [], importedGitignoreRules, input.useDefaultExcludes)
    : null
  if (skippedLocalFolderReason) {
    return blocked(localPath, local.kind, local.empty, skippedLocalFolderReason, importedGitignoreRules, detectedGitignoreRules, input.useDefaultExcludes)
  }

  if (input.kind === "file") {
    if (input.remoteExists && input.directionHint === "bind_existing") {
      if (local.kind !== "file") {
        const reason = local.kind === "folder"
          ? "本地路径是文件夹，不能绑定云盘文件。"
          : "本地文件不存在，不能和已有云盘文件建立绑定。"
        return blocked(localPath, local.kind, local.empty, reason, importedGitignoreRules, detectedGitignoreRules, input.useDefaultExcludes)
      }
      if (!await localFileSizeMatchesRemote(localPath, input.remoteSize)) {
        return blocked(localPath, local.kind, local.empty, "本地文件与云盘文件大小不一致，不能直接建立绑定。", importedGitignoreRules, detectedGitignoreRules, input.useDefaultExcludes)
      }
      return ready(localPath, local.kind, local.empty, "bind_existing", importedGitignoreRules, detectedGitignoreRules, input.useDefaultExcludes)
    }
    if (input.remoteExists && local.kind === "missing") {
      return ready(localPath, local.kind, local.empty, "remote_to_local", importedGitignoreRules, detectedGitignoreRules, input.useDefaultExcludes)
    }
    if (!input.remoteExists && local.kind === "file") {
      return ready(localPath, local.kind, local.empty, "local_to_remote", importedGitignoreRules, detectedGitignoreRules, input.useDefaultExcludes)
    }
    const reason = local.kind === "folder"
      ? "本地路径是文件夹，不能绑定云盘文件。"
      : input.remoteExists
        ? "本地文件已存在，不能和已有云盘文件直接合并。"
        : "本地文件不存在，不能创建云盘绑定。"
    return blocked(localPath, local.kind, local.empty, reason, importedGitignoreRules, detectedGitignoreRules, input.useDefaultExcludes)
  }

  if (input.remoteExists) {
    if (input.directionHint === "bind_existing") {
      if (local.kind !== "folder") {
        const reason = local.kind === "file"
          ? "本地路径是文件，不能绑定云盘文件夹。"
          : "本地文件夹不存在，不能和已有云盘文件夹建立绑定。"
        return blocked(localPath, local.kind, local.empty, reason, importedGitignoreRules, detectedGitignoreRules, input.useDefaultExcludes)
      }
      return ready(localPath, local.kind, local.empty, "bind_existing", importedGitignoreRules, detectedGitignoreRules, input.useDefaultExcludes)
    }
    const targetReady = local.kind === "missing"
      || (local.kind === "folder" && await isRemoteDownloadTargetEffectivelyEmpty(
        localPath,
        local.empty,
        input.excludeRules ?? [],
        importedGitignoreRules,
        input.useDefaultExcludes,
      ))
    if (targetReady) {
      return ready(localPath, local.kind, local.empty, "remote_to_local", importedGitignoreRules, detectedGitignoreRules, input.useDefaultExcludes)
    }
    const reason = local.kind === "file"
      ? "本地路径是文件，不能绑定云盘文件夹。"
      : "本地文件夹已有内容，不能和已有云盘文件夹直接合并。"
    return blocked(localPath, local.kind, local.empty, reason, importedGitignoreRules, detectedGitignoreRules, input.useDefaultExcludes)
  }

  if (local.kind === "folder") {
    return ready(localPath, local.kind, local.empty, "local_to_remote", importedGitignoreRules, detectedGitignoreRules, input.useDefaultExcludes)
  }

  const reason = local.kind === "file"
    ? "本地路径是文件，不能创建云盘文件夹绑定。"
    : "本地文件夹不存在，不能上传到新的云盘文件夹。"
  return blocked(localPath, local.kind, local.empty, reason, importedGitignoreRules, detectedGitignoreRules, input.useDefaultExcludes)
}

async function localFileSizeMatchesRemote(localPath: string, remoteSize: string | null | undefined): Promise<boolean> {
  const size = Number(remoteSize)
  if (!Number.isSafeInteger(size) || size < 0) return false
  const stats = await lstat(localPath)
  return stats.size === size
}

function ready(
  localPath: string,
  localKind: DriveSyncBindingPreviewDto["localKind"],
  localEmpty: boolean | null,
  direction: DriveSyncInitialDirection,
  importedGitignoreRules: readonly string[],
  detectedGitignoreRules: readonly string[],
  useDefaultExcludes: boolean | undefined,
): DriveSyncBindingPreviewDto {
  const rules = createDefaultDriveSyncExcludeRules()
  return {
    status: "ready",
    direction,
    reason: null,
    localPath,
    localKind,
    localEmpty,
    forcedExcludeRules: rules.forced,
    defaultExcludeRules: useDefaultExcludes === false ? [] : rules.defaults,
    importedGitignoreRules,
    detectedGitignoreRules,
  }
}

function blocked(
  localPath: string,
  localKind: DriveSyncBindingPreviewDto["localKind"],
  localEmpty: boolean | null,
  reason: string,
  importedGitignoreRules: readonly string[],
  detectedGitignoreRules: readonly string[],
  useDefaultExcludes: boolean | undefined,
): DriveSyncBindingPreviewDto {
  const rules = createDefaultDriveSyncExcludeRules()
  return {
    status: "blocked",
    direction: null,
    reason,
    localPath,
    localKind,
    localEmpty,
    forcedExcludeRules: rules.forced,
    defaultExcludeRules: useDefaultExcludes === false ? [] : rules.defaults,
    importedGitignoreRules,
    detectedGitignoreRules,
  }
}

async function findDuplicateBindingReason(
  localPath: string,
  driveItemId: string,
  activeBindings: readonly DriveSyncBindingEntryV1[],
): Promise<string | null> {
  const active = activeBindings.filter((binding) => binding.status !== "removed")
  if (active.some((binding) => binding.driveItemId === driveItemId)) return "云盘条目已绑定。"
  for (const binding of active) {
    if (await localPathIdentitiesOverlap(binding.localPath, localPath)) {
      return "本地路径已绑定。"
    }
  }
  return null
}

export async function readDriveSyncGitignoreRules(localPath: string): Promise<readonly string[]> {
  try {
    return parseGitignoreForDriveSync(await readFile(path.join(localPath, ".gitignore"), "utf8"))
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

function shouldRequireCompleteLocalFolder(input: {
  readonly remoteExists: boolean
  readonly directionHint?: DriveSyncInitialDirection | null
}): boolean {
  return !input.remoteExists || input.directionHint === "bind_existing"
}

async function findSkippedLocalFolderReason(
  localPath: string,
  userRules: readonly string[],
  importedGitignoreRules: readonly string[],
  useDefaultExcludes: boolean | undefined,
): Promise<string | null> {
  const snapshot = await scanDriveSyncLocalTreeDetailed({
    rootPath: localPath,
    rules: createPreviewExcludeRules(userRules, importedGitignoreRules, useDefaultExcludes),
    hashFiles: false,
  })
  return formatDriveSyncSkippedLocalEntries(snapshot.skipped)
}

async function isRemoteDownloadTargetEffectivelyEmpty(
  localPath: string,
  localEmpty: boolean | null,
  userRules: readonly string[],
  importedGitignoreRules: readonly string[],
  useDefaultExcludes: boolean | undefined,
): Promise<boolean> {
  if (localEmpty === true) return true
  const snapshot = await scanDriveSyncLocalTreeDetailed({
    rootPath: localPath,
    rules: createPreviewExcludeRules(userRules, importedGitignoreRules, useDefaultExcludes),
    hashFiles: false,
  })
  return snapshot.entries.length === 0 && snapshot.skipped.length === 0
}

function createPreviewExcludeRules(
  userRules: readonly string[],
  importedGitignoreRules: readonly string[],
  useDefaultExcludes: boolean | undefined,
): DriveSyncExcludeRulesDto {
  const defaults = createDefaultDriveSyncExcludeRules()
  return {
    forced: defaults.forced,
    defaults: useDefaultExcludes === false ? [] : defaults.defaults,
    importedGitignore: importedGitignoreRules,
    user: userRules,
  }
}
