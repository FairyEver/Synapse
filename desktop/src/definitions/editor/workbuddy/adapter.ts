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
} from "../../../../electron/services/editor-adapters/utils"

function resolveWorkBuddyHomePath(): string {
  return getHomePath(".workbuddy")
}

function resolveWorkBuddyGlobalSkillsPath(): string {
  return path.join(resolveWorkBuddyHomePath(), "skills")
}

const workbuddyAdapter: EditorAdapter = {
  id: "workbuddy",
  label: "WorkBuddy",
  order: 70,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["skill"],
  resolveGlobalDirectoryPaths() {
    return {
      rulesPath: null,
      skillsPath: resolveWorkBuddyGlobalSkillsPath(),
    }
  },
  async resolveGlobalTarget({ contentId, contentType, skillName, skillTitle }) {
    if (contentType !== "skill") {
      throw new Error(`${workbuddyAdapter.label} 暂不支持 ${contentType} 类型。`)
    }

    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: workbuddyAdapter,
        contentType,
        scope: "global",
      })
    }

    const workbuddyHomePath = resolveWorkBuddyHomePath()

    if (!(await pathExists(workbuddyHomePath))) {
      return createUnavailableTarget({
        adapter: workbuddyAdapter,
        contentType,
        message: "未检测到 WorkBuddy 的用户目录，暂时不能解析全局安装位置。",
        scope: "global",
      })
    }

    const parentDirectoryPath = resolveWorkBuddyGlobalSkillsPath()
    const slug = resolveSkillSlug(skillName, skillTitle, contentId)
    const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

    if (conflict.hasConflict) {
      return createConflictTarget({
        adapter: workbuddyAdapter,
        contentType,
        scope: "global",
        targetKind: "directory",
        targetPath: conflict.existingPath,
        conflictContentId: conflict.existingContentId,
        message: `该位置已存在名为 "${slug}" 的 Skill，是否替换？`,
      })
    }

    return createReadyTarget({
      adapter: workbuddyAdapter,
      contentType,
      scope: "global",
      targetKind: "directory",
      targetPath: path.join(parentDirectoryPath, slug),
      ownedTargetExists: conflict.ownedTargetExists,
      targetExists: conflict.targetExists,
    })
  },
  async resolveProjectTarget(projectPath, { contentId, contentType, skillName, skillTitle }) {
    if (contentType !== "skill") {
      throw new Error(`${workbuddyAdapter.label} 暂不支持 ${contentType} 类型。`)
    }

    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: workbuddyAdapter,
        contentType,
        scope: "project",
      })
    }

    const resolvedProjectPath = await resolveExistingProjectPath(projectPath)

    if (!resolvedProjectPath) {
      return createUnavailableTarget({
        adapter: workbuddyAdapter,
        contentType,
        message: "项目路径不存在，无法解析 WorkBuddy 的项目安装位置。",
        scope: "project",
      })
    }

    const parentDirectoryPath = path.join(resolvedProjectPath, ".workbuddy", "skills")
    const slug = resolveSkillSlug(skillName, skillTitle, contentId)
    const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

    if (conflict.hasConflict) {
      return createConflictTarget({
        adapter: workbuddyAdapter,
        contentType,
        scope: "project",
        targetKind: "directory",
        targetPath: conflict.existingPath,
        conflictContentId: conflict.existingContentId,
        message: `该位置已存在名为 "${slug}" 的 Skill，是否替换？`,
      })
    }

    return createReadyTarget({
      adapter: workbuddyAdapter,
      contentType,
      scope: "project",
      targetKind: "directory",
      targetPath: path.join(parentDirectoryPath, slug),
      ownedTargetExists: conflict.ownedTargetExists,
      targetExists: conflict.targetExists,
    })
  },
  getScanPathConfig() {
    return {
      globalSkillsPath: resolveWorkBuddyGlobalSkillsPath(),
      globalRulesPath: null,
      rulesSupported: false,
      detectionDir: resolveWorkBuddyHomePath(),
      projectPaths: (projectPath: string) => ({
        skillsPath: path.join(projectPath, ".workbuddy", "skills"),
        rulesPath: path.join(projectPath, ".workbuddy", "rules"),
      }),
    }
  },
}

const editorAdapter = workbuddyAdapter

export {
  editorAdapter,
  resolveWorkBuddyGlobalSkillsPath,
  resolveWorkBuddyHomePath,
  workbuddyAdapter,
}
