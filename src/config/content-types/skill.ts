import { skillsCategories } from "../categories/skills"
import type { ContentTypeDefinition } from "./types"

export const skillContentTypeDefinition: ContentTypeDefinition = {
  id: "skill",
  singularLabel: "Skill",
  pluralLabel: "Skills",
  tabLabel: "Skills",
  emptyStateNoun: "Skill",
  capabilities: {
    hasAttachments: true,
    canInstallToEditor: true,
    canCopyContent: true,
    canDownload: true,
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
