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

function resolveAntigravityHomePath(): string {
  return getHomePath(".gemini", "antigravity")
}

const antigravityAdapter: EditorAdapter = {
  id: "antigravity",
  label: "Antigravity",
  order: 50,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
  resolveGlobalDirectoryPaths() {
    return {
      rulesPath: getHomePath(".gemini", "GEMINI.md"),
      rulesPathKind: "file",
      skillsPath: path.join(resolveAntigravityHomePath(), "skills"),
    }
  },
  async resolveGlobalTarget({ contentId, contentType, skillName, skillTitle }) {
    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: antigravityAdapter,
        contentType,
        scope: "global",
      })
    }

    const antigravityHomePath = resolveAntigravityHomePath()

    if (!(await pathExists(antigravityHomePath))) {
      return createUnavailableTarget({
        adapter: antigravityAdapter,
        contentType,
        message: "未检测到 Antigravity 的用户目录，暂时不能解析全局安装位置。",
        scope: "global",
      })
    }

    switch (contentType) {
      case "rule":
        return createReadyTarget({
          adapter: antigravityAdapter,
          contentType,
          scope: "global",
          targetKind: "file",
          targetPath: getHomePath(".gemini", "GEMINI.md"),
        })
      case "skill": {
        const parentDirectoryPath = path.join(antigravityHomePath, "skills")
        const slug = resolveSkillSlug(skillName, skillTitle, contentId)
        const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

        if (conflict.hasConflict) {
          return createConflictTarget({
            adapter: antigravityAdapter,
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
          adapter: antigravityAdapter,
          contentType,
          scope: "global",
          targetKind: "directory",
          targetPath,
          ownedTargetExists: conflict.ownedTargetExists,
          targetExists: conflict.targetExists,
        })
      }
      default:
        throw new Error(`${antigravityAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
  async resolveProjectTarget(projectPath, { contentId, contentType, skillName, skillTitle, ruleName }) {
    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: antigravityAdapter,
        contentType,
        scope: "project",
      })
    }

    const resolvedProjectPath = await resolveExistingProjectPath(projectPath)

    if (!resolvedProjectPath) {
      return createUnavailableTarget({
        adapter: antigravityAdapter,
        contentType,
        message: "项目路径不存在，无法解析 Antigravity 的项目安装位置。",
        scope: "project",
      })
    }

    switch (contentType) {
      case "rule": {
        const effectiveRuleName = ruleName?.trim() || toSynapseRuleName(contentId)
        return createReadyTarget({
          adapter: antigravityAdapter,
          contentType,
          scope: "project",
          targetKind: "file",
          targetPath: path.join(resolvedProjectPath, ".agents", "rules", `${effectiveRuleName}.md`),
        })
      }
      case "skill": {
        const parentDirectoryPath = path.join(resolvedProjectPath, ".agents", "skills")
        const slug = resolveSkillSlug(skillName, skillTitle, contentId)
        const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

        if (conflict.hasConflict) {
          return createConflictTarget({
            adapter: antigravityAdapter,
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
          adapter: antigravityAdapter,
          contentType,
          scope: "project",
          targetKind: "directory",
          targetPath,
          ownedTargetExists: conflict.ownedTargetExists,
          targetExists: conflict.targetExists,
        })
      }
      default:
        throw new Error(`${antigravityAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
  getScanPathConfig() {
    return {
      globalSkillsPath: path.join(resolveAntigravityHomePath(), "skills"),
      globalRulesPath: getHomePath(".gemini", "GEMINI.md"),
      rulesSupported: true,
      detectionDir: resolveAntigravityHomePath(),
      projectPaths: (projectPath: string) => ({
        skillsPath: path.join(projectPath, ".agents", "skills"),
        rulesPath: path.join(projectPath, ".agents", "rules"),
      }),
    }
  },
}

const editorAdapter = antigravityAdapter

export { antigravityAdapter, editorAdapter, resolveAntigravityHomePath }
