import { skillsCategories } from "../categories/skills"
import type { ContentTypeDefinition } from "./types"

export const skillContentTypeDefinition: ContentTypeDefinition = {
  id: "skill",
  singularLabel: "技能",
  pluralLabel: "技能",
  tabLabel: "Skill",
  emptyStateNoun: "技能",
  capabilities: {
    hasAttachments: true,
    canInstallToEditor: true,
    canCopyContent: true,
    canDownload: true,
    canRunAsAgent: false,
  },
  download: {
    extension: ".zip",
    dialogFilterName: "Zip Archive",
    exporter: "zip-archive",
  },
  install: {
    kind: "directory-overwrite",
    confirmMessage: "Skill 安装会整体替换目标目录中的现有内容。",
  },
  repositoryDir: {
    defaultDirectoryName: "skills",
    legacyConfigKey: "skillsDir",
  },
  categories: skillsCategories,
  requiresFilesInPayload: true,
}
