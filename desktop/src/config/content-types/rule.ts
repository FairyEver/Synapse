import { rulesCategories } from "../categories/rules"
import type { ContentTypeDefinition } from "./types"

export const ruleContentTypeDefinition: ContentTypeDefinition = {
  id: "rule",
  singularLabel: "规则",
  pluralLabel: "规则",
  tabLabel: "Rule",
  emptyStateNoun: "规则",
  capabilities: {
    hasAttachments: false,
    canInstallToEditor: true,
    canCopyContent: true,
    canDownload: true,
    canRunAsAgent: false,
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
