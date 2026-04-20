import type { SynapseCategoryDefinition } from "../../types/category"
import type { SynapseContentType } from "../../types/content"

export type ContentTypeCapabilities = {
  hasAttachments: boolean
  canInstallToEditor: boolean
  canCopyContent: boolean
  canDownload: boolean
}

export type ContentDownloadSpec = {
  extension: string
  dialogFilterName: string
  exporter: "text-file" | "zip-archive"
}

export type ContentInstallSpec =
  | { kind: "none" }
  | { kind: "single-file" }
  | { kind: "directory-overwrite"; confirmMessage: string }

export type ContentRepositoryDirMapping = {
  defaultDirectoryName: string
  legacyConfigKey?: "rulesDir" | "skillsDir"
}

export type ContentTypeDefinition = {
  id: SynapseContentType
  singularLabel: string
  pluralLabel: string
  tabLabel: string
  emptyStateNoun: string
  capabilities: ContentTypeCapabilities
  download: ContentDownloadSpec
  install: ContentInstallSpec
  listPrimaryAction?: "download" | "copy"
  repositoryDir: ContentRepositoryDirMapping
  categories: readonly SynapseCategoryDefinition[]
  requiresFilesInPayload: boolean
}
