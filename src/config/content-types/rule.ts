import { rulesCategories } from "../categories/rules"
import type { ContentTypeDefinition } from "./types"

export const ruleContentTypeDefinition: ContentTypeDefinition = {
  id: "rule",
  singularLabel: "规则",
  pluralLabel: "规则",
  tabLabel: "规则",
  emptyStateNoun: "规则",
  capabilities: {
    hasAttachments: false,
    canInstallToEditor: true,
    canCopyContent: true,
    canDownload: true,
  },
  download: {
    extension: ".md",
    dialogFilterName: "Markdown",
    exporter: "text-file",
  },
  install: { kind: "single-file" },
  repositoryDir: {
    defaultDirectoryName: "rules",
    legacyConfigKey: "rulesDir",
  },
  categories: rulesCategories,
  requiresFilesInPayload: false,
}
