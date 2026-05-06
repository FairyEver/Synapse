import { promptsCategories } from "../categories/prompts"
import type { ContentTypeDefinition } from "./types"

export const promptContentTypeDefinition: ContentTypeDefinition = {
  id: "prompt",
  singularLabel: "Prompt",
  pluralLabel: "Prompts",
  tabLabel: "Prompt",
  emptyStateNoun: "prompt",
  capabilities: {
    hasAttachments: false,
    canInstallToEditor: false,
    canCopyContent: true,
    canDownload: true,
  },
  download: {
    extension: ".md",
    dialogFilterName: "Markdown",
    exporter: "text-file",
  },
  install: { kind: "none" },
  listPrimaryAction: "copy",
  repositoryDir: {
    defaultDirectoryName: "prompts",
  },
  categories: promptsCategories,
  requiresFilesInPayload: false,
}
