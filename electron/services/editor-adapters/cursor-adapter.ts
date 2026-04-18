import path from "node:path"
import type { EditorAdapter } from "./types"
import {
  createReadyTarget,
  createUnavailableTarget,
  createUnsupportedPlatformTarget,
  createUnsupportedTarget,
  getHomePath,
  getRuleFileName,
  getSkillDirectoryName,
  isSupportedEditorPlatform,
  pathExists,
  resolveExistingProjectPath,
} from "./utils"

// Source of truth: document/不同编辑器存储规则.md (official-doc review, 2026-04-18).
const cursorAdapter: EditorAdapter = {
  id: "cursor",
  label: "Cursor",
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
  async resolveGlobalTarget({ contentId, contentType }) {
    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: cursorAdapter,
        contentType,
        scope: "global",
      })
    }

    switch (contentType) {
      case "rule":
        return createUnsupportedTarget({
          adapter: cursorAdapter,
          contentType,
          message: "Cursor 官方文档未公布固定的全局 Rule 磁盘路径。",
          scope: "global",
        })
      case "skill":
        break
      default:
        throw new Error(`${cursorAdapter.label} 暂不支持 ${contentType} 类型。`)
    }

    const cursorHomePath = getHomePath(".cursor")

    if (!(await pathExists(cursorHomePath))) {
      return createUnavailableTarget({
        adapter: cursorAdapter,
        contentType,
        message: "未检测到 Cursor 的用户目录，暂时不能解析全局安装位置。",
        scope: "global",
      })
    }

    return createReadyTarget({
      adapter: cursorAdapter,
      contentType,
      scope: "global",
      targetKind: "directory",
      targetPath: path.join(cursorHomePath, "skills", getSkillDirectoryName(contentId)),
    })
  },
  async resolveProjectTarget(projectPath, { contentId, contentType }) {
    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: cursorAdapter,
        contentType,
        scope: "project",
      })
    }

    const resolvedProjectPath = await resolveExistingProjectPath(projectPath)

    if (!resolvedProjectPath) {
      return createUnavailableTarget({
        adapter: cursorAdapter,
        contentType,
        message: "项目路径不存在，无法解析 Cursor 的项目安装位置。",
        scope: "project",
      })
    }

    switch (contentType) {
      case "rule":
        return createReadyTarget({
          adapter: cursorAdapter,
          contentType,
          scope: "project",
          targetKind: "file",
          targetPath: path.join(
            resolvedProjectPath,
            ".cursor",
            "rules",
            getRuleFileName(contentId),
          ),
        })
      case "skill":
        return createReadyTarget({
          adapter: cursorAdapter,
          contentType,
          scope: "project",
          targetKind: "directory",
          targetPath: path.join(
            resolvedProjectPath,
            ".cursor",
            "skills",
            getSkillDirectoryName(contentId),
          ),
        })
      default:
        throw new Error(`${cursorAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
}

export { cursorAdapter }
