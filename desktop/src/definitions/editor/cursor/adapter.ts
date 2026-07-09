import path from "node:path"
import type { EditorAdapter } from "../../main-types"
import { resolveSkillSlug } from "../../../../electron/services/editor-adapters/skill-slug"
import { checkSkillNameConflict } from "../../../../electron/services/editor-adapters/skill-identity"
import {
  createConflictTarget,
  createReadyTarget,
  createUnavailableTarget,
  createUnsupportedPlatformTarget,
  createUnsupportedTarget,
  getHomePath,
  getRuleFileName,
  isSupportedEditorPlatform,
  pathExists,
  resolveExistingProjectPath,
} from "../../../../electron/services/editor-adapters/utils"

// Source of truth: document/不同编辑器存储规则.md (official-doc review, 2026-04-18).
const cursorAdapter: EditorAdapter = {
  id: "cursor",
  label: "Cursor",
  order: 10,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
  resolveGlobalDirectoryPaths() {
    return {
      rulesPath: null,
      skillsPath: getHomePath(".cursor", "skills"),
    }
  },
  async resolveGlobalTarget({ contentId, contentType, skillName, skillTitle }) {
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

    const parentDirectoryPath = path.join(cursorHomePath, "skills")
    const slug = resolveSkillSlug(skillName, skillTitle, contentId)

    // Check for conflict before resolving target path
    const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

    if (conflict.hasConflict) {
      return createConflictTarget({
        adapter: cursorAdapter,
        contentType,
        scope: "global",
        targetKind: "directory",
        targetPath: conflict.existingPath,
        conflictContentId: conflict.existingContentId,
        message: `该位置已存在名为 "${slug}" 的 Skill，是否替换？`,
      })
    }

    const targetPath = path.join(parentDirectoryPath, slug)

    return createReadyTarget({
      adapter: cursorAdapter,
      contentType,
      scope: "global",
      targetKind: "directory",
      targetPath,
      ownedTargetExists: conflict.ownedTargetExists,
      targetExists: conflict.targetExists,
    })
  },
  async resolveProjectTarget(projectPath, { contentId, contentType, skillName, skillTitle, ruleName }) {
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
            getRuleFileName(ruleName ?? contentId),
          ),
        })
      case "skill": {
        const parentDirectoryPath = path.join(resolvedProjectPath, ".cursor", "skills")
        const slug = resolveSkillSlug(skillName, skillTitle, contentId)

        // Check for conflict before resolving target path
        const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

        if (conflict.hasConflict) {
          return createConflictTarget({
            adapter: cursorAdapter,
            contentType,
            scope: "project",
            targetKind: "directory",
            targetPath: conflict.existingPath,
            conflictContentId: conflict.existingContentId,
            message: `该位置已存在名为 "${slug}" 的 Skill，是否替换？`,
          })
        }

        const targetPath = path.join(parentDirectoryPath, slug)

        return createReadyTarget({
          adapter: cursorAdapter,
          contentType,
          scope: "project",
          targetKind: "directory",
          targetPath,
          ownedTargetExists: conflict.ownedTargetExists,
          targetExists: conflict.targetExists,
        })
      }
      default:
        throw new Error(`${cursorAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
  getScanPathConfig() {
    return {
      globalSkillsPath: getHomePath(".cursor", "skills"),
      globalRulesPath: null,
      rulesSupported: false,
      detectionDir: getHomePath(".cursor"),
      projectPaths: (projectPath: string) => ({
        skillsPath: path.join(projectPath, ".cursor", "skills"),
        rulesPath: path.join(projectPath, ".cursor", "rules"),
      }),
    }
  },
}

const editorAdapter = cursorAdapter

export { cursorAdapter, editorAdapter }
