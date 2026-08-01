import path from "node:path"
import type { EditorAdapter } from "../../main-types"
import { resolveSkillSlug } from "../../../../electron/services/editor-adapters/skill-slug"
import { checkSkillNameConflict } from "../../../../electron/services/editor-adapters/skill-identity"
import {
  createConflictTarget,
  createReadyTarget,
  createUnavailableTarget,
  createUnsupportedPlatformTarget,
  getHomePath,
  isSupportedEditorPlatform,
  pathExists,
  resolveExistingProjectPath,
  toSynapseRuleName,
} from "../../../../electron/services/editor-adapters/utils"

// Source of truth: document/不同编辑器存储规则.md (official-doc review, 2026-04-18).
const claudeCodeAdapter: EditorAdapter = {
  id: "claude-code",
  label: "CC/Synapse",
  order: 30,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
  resolveGlobalDirectoryPaths() {
    return {
      rulesPath: getHomePath(".claude", "rules"),
      skillsPath: getHomePath(".claude", "skills"),
    }
  },
  async resolveGlobalTarget({ contentId, contentType, skillName, skillTitle, ruleName }) {
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
        message: "未检测到 CC/Synapse 的用户目录，暂时不能解析全局安装位置。",
        scope: "global",
      })
    }

    switch (contentType) {
      case "rule": {
        const effectiveRuleName = ruleName?.trim() || toSynapseRuleName(contentId)
        const targetPath = path.join(claudeHomePath, "rules", `${effectiveRuleName}.md`)
        return createReadyTarget({
          adapter: claudeCodeAdapter,
          contentType,
          scope: "global",
          targetKind: "file",
          targetPath,
        })
      }
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
          ownedTargetExists: conflict.ownedTargetExists,
          targetExists: conflict.targetExists,
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
        message: "项目路径不存在，无法解析 CC/Synapse 的项目安装位置。",
        scope: "project",
      })
    }

    switch (contentType) {
      case "rule": {
        const effectiveRuleName = ruleName?.trim() || toSynapseRuleName(contentId)
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
          ownedTargetExists: conflict.ownedTargetExists,
          targetExists: conflict.targetExists,
        })
      }
      default:
        throw new Error(`${claudeCodeAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
  getScanPathConfig() {
    return {
      globalSkillsPath: getHomePath(".claude", "skills"),
      globalRulesPath: getHomePath(".claude", "rules"),
      rulesSupported: true,
      detectionDir: getHomePath(".claude"),
      projectPaths: (projectPath: string) => ({
        skillsPath: path.join(projectPath, ".claude", "skills"),
        rulesPath: path.join(projectPath, ".claude", "rules"),
      }),
    }
  },
}

const editorAdapter = claudeCodeAdapter

export { claudeCodeAdapter, editorAdapter }
