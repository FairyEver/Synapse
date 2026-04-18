import { rulesCategories } from "../categories/rules"
import type { ContentTypeDefinition } from "./types"

export const ruleContentTypeDefinition: ContentTypeDefinition = {
  id: "rule",
  singularLabel: "Rule",
  pluralLabel: "Rules",
  tabLabel: "Rules",
  emptyStateNoun: "Rule",
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
