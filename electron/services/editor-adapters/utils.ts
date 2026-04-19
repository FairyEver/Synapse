import { access } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
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
  targetKind: SynapseEditorInstallTargetKind
  targetPath: string
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
  scope,
  targetKind,
  targetPath,
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
  return `${contentId.trim()}.mdc`
}

function isSupportedEditorPlatform(): boolean {
  return SUPPORTED_EDITOR_PLATFORMS.has(process.platform)
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function resolveExistingProjectPath(projectPath: string): Promise<string | null> {
  const trimmedProjectPath = projectPath.trim()

  if (!trimmedProjectPath) {
    return null
  }

  return (await pathExists(trimmedProjectPath)) ? trimmedProjectPath : null
}

export {
  createReadyTarget,
  createUnavailableTarget,
  createUnsupportedPlatformTarget,
  createUnsupportedTarget,
  expandHomeDirectory,
  getHomePath,
  getRuleFileName,
  isSupportedEditorPlatform,
  pathExists,
  resolveExistingProjectPath,
}
