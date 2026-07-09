import path from "node:path"
import type { EditorAdapter } from "../../main-types"
import { resolveSkillSlug } from "../../../../electron/services/editor-adapters/skill-slug"
import { checkSkillNameConflict } from "../../../../electron/services/editor-adapters/skill-identity"
import {
  createConflictTarget,
  createReadyTarget,
  createUnavailableTarget,
  createUnsupportedPlatformTarget,
  expandHomeDirectory,
  getHomePath,
  isSupportedEditorPlatform,
  pathExists,
  resolveExistingProjectPath,
} from "../../../../electron/services/editor-adapters/utils"

function resolveHermesHomePath(): string {
  const configuredHermesHome = process.env.HERMES_HOME?.trim()

  if (configuredHermesHome) {
    return path.resolve(expandHomeDirectory(configuredHermesHome))
  }

  return getHomePath(".hermes")
}

function resolveHermesGlobalSkillsPath(): string {
  return path.join(resolveHermesHomePath(), "skills")
}

// Source of truth: document/不同编辑器存储规则.md (official-doc review, 2026-04-18).
const hermesAdapter: EditorAdapter = {
  id: "hermes",
  label: "Hermes",
  order: 60,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
  resolveGlobalDirectoryPaths() {
    return {
      rulesPath: resolveHermesHomePath(),
      skillsPath: resolveHermesGlobalSkillsPath(),
    }
  },
  async resolveGlobalTarget({ contentId, contentType, skillName, skillTitle }) {
    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: hermesAdapter,
        contentType,
        scope: "global",
      })
    }

    switch (contentType) {
      case "rule": {
        const hermesHomePath = resolveHermesHomePath()

        if (!(await pathExists(hermesHomePath))) {
          return createUnavailableTarget({
            adapter: hermesAdapter,
            contentType,
            message: "未检测到 Hermes 的用户目录，暂时不能解析全局安装位置。",
            scope: "global",
          })
        }

        return createReadyTarget({
          adapter: hermesAdapter,
          contentType,
          scope: "global",
          targetKind: "file",
          targetPath: path.join(hermesHomePath, "SOUL.md"),
        })
      }
      case "skill": {
        const parentDirectoryPath = resolveHermesGlobalSkillsPath()
        const slug = resolveSkillSlug(skillName, skillTitle, contentId)

        // Check for conflict before resolving target path
        const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

        if (conflict.hasConflict) {
          return createConflictTarget({
            adapter: hermesAdapter,
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
          adapter: hermesAdapter,
          contentType,
          scope: "global",
          targetKind: "directory",
          targetPath,
          ownedTargetExists: conflict.ownedTargetExists,
          targetExists: conflict.targetExists,
        })
      }
      default:
        throw new Error(`${hermesAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
  async resolveProjectTarget(projectPath, { contentId, contentType, skillName, skillTitle }) {
    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: hermesAdapter,
        contentType,
        scope: "project",
      })
    }

    const resolvedProjectPath = await resolveExistingProjectPath(projectPath)

    if (!resolvedProjectPath) {
      return createUnavailableTarget({
        adapter: hermesAdapter,
        contentType,
        message: "项目路径不存在，无法解析 Hermes 的项目安装位置。",
        scope: "project",
      })
    }

    switch (contentType) {
      case "rule":
        return createReadyTarget({
          adapter: hermesAdapter,
          contentType,
          scope: "project",
          targetKind: "file",
          targetPath: path.join(resolvedProjectPath, ".hermes.md"),
        })
      case "skill": {
        const parentDirectoryPath = path.join(resolvedProjectPath, ".hermes", "skills")
        const slug = resolveSkillSlug(skillName, skillTitle, contentId)

        // Check for conflict before resolving target path
        const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

        if (conflict.hasConflict) {
          return createConflictTarget({
            adapter: hermesAdapter,
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
          adapter: hermesAdapter,
          contentType,
          scope: "project",
          targetKind: "directory",
          targetPath,
          ownedTargetExists: conflict.ownedTargetExists,
          targetExists: conflict.targetExists,
        })
      }
      default:
        throw new Error(`${hermesAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
  getScanPathConfig() {
    const hermesHome = resolveHermesHomePath()
    return {
      globalSkillsPath: resolveHermesGlobalSkillsPath(),
      globalRulesPath: path.join(hermesHome, "SOUL.md"),
      rulesSupported: true,
      detectionDir: hermesHome,
      projectPaths: (projectPath: string) => ({
        skillsPath: path.join(projectPath, ".hermes", "skills"),
        rulesPath: path.join(projectPath, ".hermes.md"),
      }),
    }
  },
}

const editorAdapter = hermesAdapter

export {
  hermesAdapter,
  editorAdapter,
  resolveHermesGlobalSkillsPath,
  resolveHermesHomePath,
}
