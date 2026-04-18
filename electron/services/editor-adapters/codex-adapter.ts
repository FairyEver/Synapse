import path from "node:path"
import type { EditorAdapter } from "./types"
import {
  createReadyTarget,
  createUnavailableTarget,
  createUnsupportedPlatformTarget,
  expandHomeDirectory,
  getHomePath,
  getSkillDirectoryName,
  isSupportedEditorPlatform,
  pathExists,
  resolveExistingProjectPath,
} from "./utils"

function resolveCodexHomePath(): string {
  const configuredCodexHome = process.env.CODEX_HOME?.trim()

  if (configuredCodexHome) {
    return path.resolve(expandHomeDirectory(configuredCodexHome))
  }

  return getHomePath(".codex")
}

// Source of truth: document/不同编辑器存储规则.md (official-doc review, 2026-04-18).
const codexAdapter: EditorAdapter = {
  id: "codex",
  label: "Codex",
  supportsGlobal: true,
  supportsProject: true,
  supportsRule: true,
  supportsSkill: true,
  async resolveGlobalTarget({ contentId, contentType }) {
    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: codexAdapter,
        contentType,
        scope: "global",
      })
    }

    const codexHomePath = resolveCodexHomePath()

    if (!(await pathExists(codexHomePath))) {
      return createUnavailableTarget({
        adapter: codexAdapter,
        contentType,
        message: "未检测到 Codex 的用户目录，暂时不能解析全局安装位置。",
        scope: "global",
      })
    }

    if (contentType === "rule") {
      return createReadyTarget({
        adapter: codexAdapter,
        contentType,
        scope: "global",
        targetKind: "file",
        targetPath: path.join(codexHomePath, "AGENTS.md"),
      })
    }

    return createReadyTarget({
      adapter: codexAdapter,
      contentType,
      scope: "global",
      targetKind: "directory",
      targetPath: path.join(getHomePath(".agents", "skills"), getSkillDirectoryName(contentId)),
    })
  },
  async resolveProjectTarget(projectPath, { contentId, contentType }) {
    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: codexAdapter,
        contentType,
        scope: "project",
      })
    }

    const resolvedProjectPath = await resolveExistingProjectPath(projectPath)

    if (!resolvedProjectPath) {
      return createUnavailableTarget({
        adapter: codexAdapter,
        contentType,
        message: "项目路径不存在，无法解析 Codex 的项目安装位置。",
        scope: "project",
      })
    }

    if (contentType === "rule") {
      return createReadyTarget({
        adapter: codexAdapter,
        contentType,
        scope: "project",
        targetKind: "file",
        targetPath: path.join(resolvedProjectPath, "AGENTS.md"),
      })
    }

    return createReadyTarget({
      adapter: codexAdapter,
      contentType,
      scope: "project",
      targetKind: "directory",
      targetPath: path.join(
        resolvedProjectPath,
        ".agents",
        "skills",
        getSkillDirectoryName(contentId),
      ),
    })
  },
}

export { codexAdapter }
