import path from "node:path"
import type { EditorAdapter } from "./types"
import { resolveSkillSlug } from "./skill-slug"
import { checkSkillNameConflict, resolveSkillTargetPath } from "./skill-identity"
import {
  createConflictTarget,
  createReadyTarget,
  createUnavailableTarget,
  createUnsupportedPlatformTarget,
  getHomePath,
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
  async resolveGlobalTarget({ contentId, contentType, skillName, skillTitle }) {
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
      case "skill": {
        const parentDirectoryPath = path.join(claudeHomePath, "skills")
        const slug = resolveSkillSlug(skillName, skillTitle, contentId)

        // Check for conflict before resolving target path
        const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

        if (conflict.hasConflict) {
          return createConflictTarget({
            adapter: claudeCodeAdapter,
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
          adapter: claudeCodeAdapter,
          contentType,
          scope: "global",
          targetKind: "directory",
          targetPath,
        })
      }
      default:
        throw new Error(`${claudeCodeAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
  async resolveProjectTarget(projectPath, { contentId, contentType, skillName, skillTitle, ruleName }) {
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
      case "rule": {
        const effectiveRuleName = ruleName?.trim() || `synapse_${contentId}`
        const targetPath = path.join(resolvedProjectPath, ".claude", "rules", `${effectiveRuleName}.md`)
        return createReadyTarget({
          adapter: claudeCodeAdapter,
          contentType,
          scope: "project",
          targetKind: "file",
          targetPath,
        })
      }
      case "skill": {
        const parentDirectoryPath = path.join(resolvedProjectPath, ".claude", "skills")
        const slug = resolveSkillSlug(skillName, skillTitle, contentId)

        // Check for conflict before resolving target path
        const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

        if (conflict.hasConflict) {
          return createConflictTarget({
            adapter: claudeCodeAdapter,
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
          adapter: claudeCodeAdapter,
          contentType,
          scope: "project",
          targetKind: "directory",
          targetPath,
        })
      }
      default:
        throw new Error(`${claudeCodeAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
}

export { claudeCodeAdapter }
