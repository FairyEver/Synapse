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

function resolveWindsurfHomePath(): string {
  return getHomePath(".codeium", "windsurf")
}

// Source of truth: https://docs.windsurf.com/windsurf/cascade/memories and /skills.
const windsurfAdapter: EditorAdapter = {
  id: "windsurf",
  label: "Windsurf",
  order: 40,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
  resolveGlobalDirectoryPaths() {
    const windsurfHomePath = resolveWindsurfHomePath()
    return {
      rulesPath: path.join(windsurfHomePath, "memories", "global_rules.md"),
      rulesPathKind: "file",
      skillsPath: path.join(windsurfHomePath, "skills"),
    }
  },
  async resolveGlobalTarget({ contentId, contentType, skillName, skillTitle }) {
    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: windsurfAdapter,
        contentType,
        scope: "global",
      })
    }

    const windsurfHomePath = resolveWindsurfHomePath()

    if (!(await pathExists(windsurfHomePath))) {
      return createUnavailableTarget({
        adapter: windsurfAdapter,
        contentType,
        message: "未检测到 Windsurf 的用户目录，暂时不能解析全局安装位置。",
        scope: "global",
      })
    }

    switch (contentType) {
      case "rule":
        return createReadyTarget({
          adapter: windsurfAdapter,
          contentType,
          scope: "global",
          targetKind: "file",
          targetPath: path.join(windsurfHomePath, "memories", "global_rules.md"),
        })
      case "skill": {
        const parentDirectoryPath = path.join(windsurfHomePath, "skills")
        const slug = resolveSkillSlug(skillName, skillTitle, contentId)
        const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

        if (conflict.hasConflict) {
          return createConflictTarget({
            adapter: windsurfAdapter,
            contentType,
            scope: "global",
            targetKind: "directory",
            targetPath: conflict.existingPath,
            conflictContentId: conflict.existingContentId,
            message: `该位置已存在名为 "${slug}" 的 Skill，是否替换？`,
          })
        }

        return createReadyTarget({
          adapter: windsurfAdapter,
          contentType,
          scope: "global",
          targetKind: "directory",
          targetPath: path.join(parentDirectoryPath, slug),
          ownedTargetExists: conflict.ownedTargetExists,
          targetExists: conflict.targetExists,
        })
      }
      default:
        throw new Error(`${windsurfAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
  async resolveProjectTarget(projectPath, { contentId, contentType, skillName, skillTitle, ruleName }) {
    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: windsurfAdapter,
        contentType,
        scope: "project",
      })
    }

    const resolvedProjectPath = await resolveExistingProjectPath(projectPath)

    if (!resolvedProjectPath) {
      return createUnavailableTarget({
        adapter: windsurfAdapter,
        contentType,
        message: "项目路径不存在，无法解析 Windsurf 的项目安装位置。",
        scope: "project",
      })
    }

    switch (contentType) {
      case "rule": {
        const effectiveRuleName = ruleName?.trim() || toSynapseRuleName(contentId)
        return createReadyTarget({
          adapter: windsurfAdapter,
          contentType,
          scope: "project",
          targetKind: "file",
          targetPath: path.join(resolvedProjectPath, ".windsurf", "rules", `${effectiveRuleName}.md`),
        })
      }
      case "skill": {
        const parentDirectoryPath = path.join(resolvedProjectPath, ".windsurf", "skills")
        const slug = resolveSkillSlug(skillName, skillTitle, contentId)
        const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

        if (conflict.hasConflict) {
          return createConflictTarget({
            adapter: windsurfAdapter,
            contentType,
            scope: "project",
            targetKind: "directory",
            targetPath: conflict.existingPath,
            conflictContentId: conflict.existingContentId,
            message: `该位置已存在名为 "${slug}" 的 Skill，是否替换？`,
          })
        }

        return createReadyTarget({
          adapter: windsurfAdapter,
          contentType,
          scope: "project",
          targetKind: "directory",
          targetPath: path.join(parentDirectoryPath, slug),
          ownedTargetExists: conflict.ownedTargetExists,
          targetExists: conflict.targetExists,
        })
      }
      default:
        throw new Error(`${windsurfAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
  getScanPathConfig() {
    const windsurfHomePath = resolveWindsurfHomePath()
    return {
      globalSkillsPath: path.join(windsurfHomePath, "skills"),
      globalRulesPath: path.join(windsurfHomePath, "memories", "global_rules.md"),
      rulesSupported: true,
      detectionDir: windsurfHomePath,
      projectPaths: (projectPath: string) => ({
        skillsPath: path.join(projectPath, ".windsurf", "skills"),
        rulesPath: path.join(projectPath, ".windsurf", "rules"),
      }),
    }
  },
}

const editorAdapter = windsurfAdapter

export { editorAdapter, resolveWindsurfHomePath, windsurfAdapter }
