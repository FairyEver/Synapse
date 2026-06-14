export type ContentStoreType = "skill" | "rule" | "prompt"
export type ContentStoreVisibility = "private" | "public"
export type ContentStoreModerationStatus = "normal" | "removed"
export type ContentStoreFileKind = "text" | "binary"

export interface ContentStoreOwnerDto {
  readonly id: string
  readonly displayName: string | null
}

export interface ContentStoreFileDto {
  readonly path: string
  readonly size: number
  readonly sha256: string
  readonly kind: ContentStoreFileKind
  readonly mimeType: string | null
  readonly text?: string
}

export interface ContentStoreItemDto {
  readonly id: string
  readonly type: ContentStoreType
  readonly title: string
  readonly description: string | null
  readonly visibility: ContentStoreVisibility
  readonly moderationStatus: ContentStoreModerationStatus
  readonly featured: boolean
  readonly owner: ContentStoreOwnerDto
  readonly latestVersionId: string | null
  readonly latestVersionNumber: number | null
  readonly installCount: number
  readonly copiedFromContentId: string | null
  readonly copiedFromVersionId: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ContentStoreVersionDto {
  readonly id: string
  readonly itemId: string
  readonly versionNumber: number
  readonly packageSha256: string | null
  readonly packageSize: string | null
  readonly createdAt: string
}

export interface ContentStoreDetailDto extends ContentStoreItemDto {
  readonly latestVersion: ContentStoreVersionDto | null
  readonly body: string | null
  readonly files: ContentStoreFileDto[]
}

export interface ContentStoreDraftDto {
  readonly id: string
  readonly itemId: string
  readonly baseVersionId: string | null
  readonly revision: number
  readonly title: string
  readonly description: string | null
  readonly body: string | null
  readonly files: ContentStoreFileDto[]
  readonly updatedAt: string
}

export interface ContentStoreInstallSessionDto {
  readonly id: string
  readonly contentId: string
  readonly versionId: string
  readonly type: Extract<ContentStoreType, "skill" | "rule">
  readonly title: string
  readonly packageSha256: string
  readonly expiresAt: string
  readonly deepLinkUrl: string
}

export interface ContentStoreInstallManifestFile {
  readonly path: string
  readonly size: number
  readonly sha256: string
  readonly kind: ContentStoreFileKind
}

export interface ContentStoreInstallManifest {
  readonly schemaVersion: 1
  readonly contentId: string
  readonly versionId: string
  readonly type: Extract<ContentStoreType, "skill" | "rule">
  readonly title: string
  readonly mainFile: "content/SKILL.md" | "content/RULE.md"
  readonly files: ContentStoreInstallManifestFile[]
}
