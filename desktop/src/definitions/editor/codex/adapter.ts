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

function resolveCodexHomePath(): string {
  const configuredCodexHome = process.env.CODEX_HOME?.trim()

  if (configuredCodexHome) {
    return path.resolve(expandHomeDirectory(configuredCodexHome))
  }

  return getHomePath(".codex")
}

function resolveCodexGlobalSkillsPath(): string {
  return getHomePath(".agents", "skills")
}

function resolveCodexCompatSkillsPath(): string {
  return path.join(resolveCodexHomePath(), "skills")
}

function resolveCodexGlobalSkillPaths(): readonly string[] {
  const primaryPath = resolveCodexGlobalSkillsPath()
  const compatPath = resolveCodexCompatSkillsPath()

  return primaryPath === compatPath ? [primaryPath] : [primaryPath, compatPath]
}

// Source of truth: document/不同编辑器存储规则.md (official-doc review, 2026-04-18).
const codexAdapter: EditorAdapter = {
  id: "codex",
  label: "Codex",
  order: 20,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
  resolveGlobalDirectoryPaths() {
    return {
      rulesPath: resolveCodexHomePath(),
      skillsPath: resolveCodexGlobalSkillsPath(),
    }
  },
  async resolveGlobalTarget({ contentId, contentType, skillName, skillTitle }) {
    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: codexAdapter,
        contentType,
        scope: "global",
      })
    }

    switch (contentType) {
      case "rule": {
        const codexHomePath = resolveCodexHomePath()

        if (!(await pathExists(codexHomePath))) {
          return createUnavailableTarget({
            adapter: codexAdapter,
            contentType,
            message: "未检测到 Codex 的用户目录，暂时不能解析全局安装位置。",
            scope: "global",
          })
        }

        return createReadyTarget({
          adapter: codexAdapter,
          contentType,
          scope: "global",
          targetKind: "file",
          targetPath: path.join(codexHomePath, "AGENTS.md"),
        })
      }
      case "skill": {
        const parentDirectoryPath = resolveCodexGlobalSkillsPath()
        const slug = resolveSkillSlug(skillName, skillTitle, contentId)

        // Check for conflict before resolving target path
        const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

        if (conflict.hasConflict) {
          return createConflictTarget({
            adapter: codexAdapter,
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
          adapter: codexAdapter,
          contentType,
          scope: "global",
          targetKind: "directory",
          targetPath,
          ownedTargetExists: conflict.ownedTargetExists,
          targetExists: conflict.targetExists,
        })
      }
      default:
        throw new Error(`${codexAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
  async resolveProjectTarget(projectPath, { contentId, contentType, skillName, skillTitle }) {
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

    switch (contentType) {
      case "rule":
        return createReadyTarget({
          adapter: codexAdapter,
          contentType,
          scope: "project",
          targetKind: "file",
          targetPath: path.join(resolvedProjectPath, "AGENTS.md"),
        })
      case "skill": {
        const parentDirectoryPath = path.join(resolvedProjectPath, ".agents", "skills")
        const slug = resolveSkillSlug(skillName, skillTitle, contentId)

        // Check for conflict before resolving target path
        const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

        if (conflict.hasConflict) {
          return createConflictTarget({
            adapter: codexAdapter,
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
          adapter: codexAdapter,
          contentType,
          scope: "project",
          targetKind: "directory",
          targetPath,
          ownedTargetExists: conflict.ownedTargetExists,
          targetExists: conflict.targetExists,
        })
      }
      default:
        throw new Error(`${codexAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
  getScanPathConfig() {
    const codexHome = resolveCodexHomePath()
    return {
      globalSkillsPath: resolveCodexGlobalSkillsPath(),
      globalSkillPaths: resolveCodexGlobalSkillPaths(),
      globalRulesPath: path.join(codexHome, "AGENTS.md"),
      rulesSupported: true,
      detectionDir: codexHome,
      projectPaths: (projectPath: string) => ({
        skillsPath: path.join(projectPath, ".agents", "skills"),
        rulesPath: path.join(projectPath, "AGENTS.md"),
      }),
    }
  },
}

const editorAdapter = codexAdapter

export {
  codexAdapter,
  editorAdapter,
  resolveCodexCompatSkillsPath,
  resolveCodexGlobalSkillPaths,
  resolveCodexGlobalSkillsPath,
  resolveCodexHomePath,
}
