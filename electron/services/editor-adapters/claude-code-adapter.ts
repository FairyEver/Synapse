import path from "node:path"
import type { EditorAdapter } from "./types"
import {
  createReadyTarget,
  createUnavailableTarget,
  createUnsupportedPlatformTarget,
  getHomePath,
  getSkillDirectoryName,
  isSupportedEditorPlatform,
  pathExists,
  resolveExistingProjectPath,
} from "./utils"

// Source of truth: document/不同编辑器存储规则.md (official-doc review, 2026-04-18).
const claudeCodeAdapter: EditorAdapter = {
  id: "claude-code",
  label: "Claude Code",
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
  async resolveGlobalTarget({ contentId, contentType }) {
    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: claudeCodeAdapter,
        contentType,
        scope: "global",
      })
    }

    const claudeHomePath = getHomePath(".claude")

    if (!(await pathExists(claudeHomePath))) {
      return createUnavailableTarget({
        adapter: claudeCodeAdapter,
        contentType,
        message: "未检测到 Claude Code 的用户目录，暂时不能解析全局安装位置。",
        scope: "global",
      })
    }

    switch (contentType) {
      case "rule":
        return createReadyTarget({
          adapter: claudeCodeAdapter,
          contentType,
          scope: "global",
          targetKind: "file",
          targetPath: path.join(claudeHomePath, "CLAUDE.md"),
        })
      case "skill":
        return createReadyTarget({
          adapter: claudeCodeAdapter,
          contentType,
          scope: "global",
          targetKind: "directory",
          targetPath: path.join(claudeHomePath, "skills", getSkillDirectoryName(contentId)),
        })
      default:
        throw new Error(`${claudeCodeAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
  async resolveProjectTarget(projectPath, { contentId, contentType }) {
    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: claudeCodeAdapter,
        contentType,
        scope: "project",
      })
    }

    const resolvedProjectPath = await resolveExistingProjectPath(projectPath)

    if (!resolvedProjectPath) {
      return createUnavailableTarget({
        adapter: claudeCodeAdapter,
        contentType,
        message: "项目路径不存在，无法解析 Claude Code 的项目安装位置。",
        scope: "project",
      })
    }

    switch (contentType) {
      case "rule":
        return createReadyTarget({
          adapter: claudeCodeAdapter,
          contentType,
          scope: "project",
          targetKind: "file",
          targetPath: path.join(resolvedProjectPath, "CLAUDE.md"),
        })
      case "skill":
        return createReadyTarget({
          adapter: claudeCodeAdapter,
          contentType,
          scope: "project",
          targetKind: "directory",
          targetPath: path.join(
            resolvedProjectPath,
            ".claude",
            "skills",
            getSkillDirectoryName(contentId),
          ),
        })
      default:
        throw new Error(`${claudeCodeAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
}

export { claudeCodeAdapter }
