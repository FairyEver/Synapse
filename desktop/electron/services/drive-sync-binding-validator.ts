import { lstat, readFile } from "node:fs/promises"
import path from "node:path"
import type { DriveSyncBindingPreviewDto, DriveSyncInitialDirection } from "@synapse/shared" with { "resolution-mode": "import" }
import type { DriveSyncBindingEntryV1 } from "../runtime/data-repo"
import { createDefaultDriveSyncExcludeRules, parseGitignoreForDriveSync } from "./drive-sync-excludes"
import { inspectDriveSyncLocalPath } from "./drive-sync-local-snapshot"
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
}): Promise<DriveSyncBindingPreviewDto> {
  const localPath = normalizeLocalPath(input.localPath)
  const rules = createDefaultDriveSyncExcludeRules()
  const local = await inspectDriveSyncLocalPath(localPath)
  const duplicateReason = await findDuplicateBindingReason(localPath, input.driveItemId, input.activeBindings)
  if (duplicateReason) {
    return blocked(localPath, local.kind, local.empty, duplicateReason, rules.importedGitignore)
  }

  const importedGitignoreRules = input.importGitignore && local.kind === "folder"
    ? await readDriveSyncGitignoreRules(localPath)
    : []

  if (input.kind === "file") {
    if (input.remoteExists && input.directionHint === "bind_existing") {
      if (local.kind !== "file") {
        const reason = local.kind === "folder"
          ? "本地路径是文件夹，不能绑定云盘文件。"
          : "本地文件不存在，不能和已有云盘文件建立绑定。"
        return blocked(localPath, local.kind, local.empty, reason, importedGitignoreRules)
      }
      if (!await localFileSizeMatchesRemote(localPath, input.remoteSize)) {
        return blocked(localPath, local.kind, local.empty, "本地文件与云盘文件大小不一致，不能直接建立绑定。", importedGitignoreRules)
      }
      return ready(localPath, local.kind, local.empty, "bind_existing", importedGitignoreRules)
    }
    if (input.remoteExists && local.kind === "missing") {
      return ready(localPath, local.kind, local.empty, "remote_to_local", importedGitignoreRules)
    }
    if (!input.remoteExists && local.kind === "file") {
      return ready(localPath, local.kind, local.empty, "local_to_remote", importedGitignoreRules)
    }
    const reason = local.kind === "folder"
      ? "本地路径是文件夹，不能绑定云盘文件。"
      : input.remoteExists
        ? "本地文件已存在，不能和已有云盘文件直接合并。"
        : "本地文件不存在，不能创建云盘绑定。"
    return blocked(localPath, local.kind, local.empty, reason, importedGitignoreRules)
  }

  if (input.remoteExists) {
    if (input.directionHint === "bind_existing") {
      if (local.kind !== "folder") {
        const reason = local.kind === "file"
          ? "本地路径是文件，不能绑定云盘文件夹。"
          : "本地文件夹不存在，不能和已有云盘文件夹建立绑定。"
        return blocked(localPath, local.kind, local.empty, reason, importedGitignoreRules)
      }
      return ready(localPath, local.kind, local.empty, "bind_existing", importedGitignoreRules)
    }
    if (local.kind === "missing" || (local.kind === "folder" && local.empty === true)) {
      return ready(localPath, local.kind, local.empty, "remote_to_local", importedGitignoreRules)
    }
    const reason = local.kind === "file"
      ? "本地路径是文件，不能绑定云盘文件夹。"
      : "本地文件夹已有内容，不能和已有云盘文件夹直接合并。"
    return blocked(localPath, local.kind, local.empty, reason, importedGitignoreRules)
  }

  if (local.kind === "folder") {
    return ready(localPath, local.kind, local.empty, "local_to_remote", importedGitignoreRules)
  }

  const reason = local.kind === "file"
    ? "本地路径是文件，不能创建云盘文件夹绑定。"
    : "本地文件夹不存在，不能上传到新的云盘文件夹。"
  return blocked(localPath, local.kind, local.empty, reason, importedGitignoreRules)
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
    defaultExcludeRules: rules.defaults,
    importedGitignoreRules,
  }
}

function blocked(
  localPath: string,
  localKind: DriveSyncBindingPreviewDto["localKind"],
  localEmpty: boolean | null,
  reason: string,
  importedGitignoreRules: readonly string[],
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
    defaultExcludeRules: rules.defaults,
    importedGitignoreRules,
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
