import os from "node:os"
import path from "node:path"
import { pathExists } from "../fs-utils"
import type { SynapseContentType } from "../../../src/types/content"
import type {
  SynapseEditorAdapterSummary,
  SynapseEditorInstallScope,
  SynapseEditorInstallTargetKind,
  SynapseEditorResolvedTarget,
} from "../../../src/types/editor"

const SUPPORTED_EDITOR_PLATFORMS = new Set(["darwin", "linux", "win32"])

type CreateTargetBaseOptions = {
  adapter: SynapseEditorAdapterSummary
  contentType: SynapseContentType
  scope: SynapseEditorInstallScope
}

type CreateReadyTargetOptions = CreateTargetBaseOptions & {
  message?: string | null
  ownedTargetExists?: boolean
  targetKind: SynapseEditorInstallTargetKind
  targetPath: string
  targetExists?: boolean
}

type CreateUnreadyTargetOptions = CreateTargetBaseOptions & {
  message: string
}

function createTargetBase({
  adapter,
  contentType,
  scope,
}: CreateTargetBaseOptions) {
  return {
    contentType,
    editorId: adapter.id,
    label: adapter.label,
    scope,
  }
}

function createReadyTarget({
  adapter,
  contentType,
  message = null,
  ownedTargetExists,
  scope,
  targetKind,
  targetPath,
  targetExists = false,
}: CreateReadyTargetOptions): SynapseEditorResolvedTarget {
  return {
    ...createTargetBase({
      adapter,
      contentType,
      scope,
    }),
    message,
    status: "ready",
    targetKind,
    targetPath,
    targetExists,
    ...(ownedTargetExists ? { ownedTargetExists } : {}),
  }
}

function createUnsupportedTarget({
  adapter,
  contentType,
  message,
  scope,
}: CreateUnreadyTargetOptions): SynapseEditorResolvedTarget {
  return {
    ...createTargetBase({
      adapter,
      contentType,
      scope,
    }),
    message,
    status: "unsupported",
    targetKind: null,
    targetPath: null,
  }
}

function createUnavailableTarget({
  adapter,
  contentType,
  message,
  scope,
}: CreateUnreadyTargetOptions): SynapseEditorResolvedTarget {
  return {
    ...createTargetBase({
      adapter,
      contentType,
      scope,
    }),
    message,
    status: "unavailable",
    targetKind: null,
    targetPath: null,
  }
}

function createUnsupportedPlatformTarget(
  options: CreateTargetBaseOptions,
): SynapseEditorResolvedTarget {
  return createUnsupportedTarget({
    ...options,
    message: "当前系统暂不支持该编辑器的安装路径解析。",
  })
}

type CreateConflictTargetOptions = CreateTargetBaseOptions & {
  targetKind: SynapseEditorInstallTargetKind
  targetPath: string
  conflictContentId: string
  message: string
}

function createConflictTarget({
  adapter,
  contentType,
  scope,
  targetKind,
  targetPath,
  conflictContentId,
  message,
}: CreateConflictTargetOptions): SynapseEditorResolvedTarget {
  return {
    ...createTargetBase({
      adapter,
      contentType,
      scope,
    }),
    status: "conflict",
    targetKind,
    targetPath,
    conflictContentId,
    message,
  }
}

function expandHomeDirectory(value: string): string {
  const trimmedValue = value.trim()

  if (trimmedValue === "~") {
    return os.homedir()
  }

  if (trimmedValue.startsWith("~/") || trimmedValue.startsWith("~\\")) {
    return path.join(os.homedir(), trimmedValue.slice(2))
  }

  return trimmedValue
}

function getHomePath(...segments: string[]): string {
  return path.join(os.homedir(), ...segments)
}

function getRuleFileName(contentId: string): string {
  const baseName = path.basename(contentId.trim()).replace(/\.(md|mdc)$/iu, "")
  return `${baseName}.mdc`
}

function isSupportedEditorPlatform(): boolean {
  return SUPPORTED_EDITOR_PLATFORMS.has(process.platform)
}

async function resolveExistingProjectPath(projectPath: string): Promise<string | null> {
  const trimmedProjectPath = projectPath.trim()

  if (!trimmedProjectPath) {
    return null
  }

  return (await pathExists(trimmedProjectPath)) ? trimmedProjectPath : null
}

const SYNAPSE_FILE_PREFIX = "synapse_"

function toSynapseRuleName(contentId: string): string {
  return `${SYNAPSE_FILE_PREFIX}${contentId}`
}

function isSynapseFile(fileName: string): boolean {
  return fileName.startsWith(SYNAPSE_FILE_PREFIX)
}

function extractContentIdFromSynapseFile(fileName: string): string {
  return fileName.replace(/^synapse_/, "").replace(/\.\w+$/, "")
}

export {
  createConflictTarget,
  createReadyTarget,
  createUnavailableTarget,
  createUnsupportedPlatformTarget,
  createUnsupportedTarget,
  expandHomeDirectory,
  extractContentIdFromSynapseFile,
  getHomePath,
  getRuleFileName,
  isSupportedEditorPlatform,
  isSynapseFile,
  pathExists,
  resolveExistingProjectPath,
  SYNAPSE_FILE_PREFIX,
  toSynapseRuleName,
}
