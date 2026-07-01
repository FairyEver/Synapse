export type SkillRepositoryVisibility = "private" | "public"
export type SkillRepositoryStatus = "active" | "removed"
export type SkillRepositoryFileKind = "text" | "binary"

export const skillRepositoryMaxTotalBytes = 50 * 1024 * 1024
export const skillRepositoryMaxFileBytes = 20 * 1024 * 1024
export const skillRepositoryMaxFileCount = 200
export const skillRepositoryNameMaxLength = 64
export const userHandleMaxLength = 64
export const reservedUserHandles = ["api", "console", "files", "share", "sites", "webhooks"] as const

export const skillRepositoryErrorCodes = [
  "USER_HANDLE_REQUIRED",
  "SKILL_REPOSITORY_NAME_CONFLICT",
  "SKILL_REPOSITORY_FORBIDDEN",
  "SKILL_REPOSITORY_NOT_FOUND",
  "SKILL_REPOSITORY_INVALID_SKILL",
] as const

export type SkillRepositoryErrorCode = (typeof skillRepositoryErrorCodes)[number]

export interface SkillRepositoryOwnerDto {
  readonly id: string
  readonly handle: string | null
  readonly displayName: string | null
}

export interface SkillRepositoryFileDto {
  readonly id: string
  readonly path: string
  readonly size: number
  readonly sha256: string
  readonly kind: SkillRepositoryFileKind
  readonly mimeType: string | null
  readonly text?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface SkillRepositoryItemDto {
  readonly id: string
  readonly name: string
  readonly title: string
  readonly description: string | null
  readonly visibility: SkillRepositoryVisibility
  readonly status: SkillRepositoryStatus
  readonly owner: SkillRepositoryOwnerDto
  readonly forkedFromRepositoryId: string | null
  readonly legacyContentStoreItemId: string | null
  readonly legacyInstallCount: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastSyncedAt: string | null
}

export interface SkillRepositoryDetailDto extends SkillRepositoryItemDto {
  readonly files: readonly SkillRepositoryFileDto[]
}

export interface SkillRepositoryImportFileInput {
  readonly path: string
  readonly contentBase64: string
  readonly mimeType?: string | null
}

export interface SkillRepositoryImportInput {
  readonly repositoryId?: string | null
  readonly name?: string | null
  readonly title?: string | null
  readonly description?: string | null
  readonly files: readonly SkillRepositoryImportFileInput[]
}

const namePattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u
const nameBoundaryPattern = /^[a-z0-9].*[a-z0-9]$|^[a-z0-9]$/u
const windowsReservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu
const reservedUserHandleSet = new Set<string>(reservedUserHandles)

export function normalizeSkillRepositoryName(value: string): string {
  return normalizeDashedIdentifier(value, "仓库名", skillRepositoryNameMaxLength)
}

export function normalizeUserHandle(value: string): string {
  const normalized = normalizeDashedIdentifier(value, "用户名", userHandleMaxLength)
  if (reservedUserHandleSet.has(normalized)) throw new Error("用户名不能使用保留路由名称。")
  return normalized
}

export function buildSkillRepositoryManagementUrl(publicAppUrl: string, repositoryId: string): string {
  const base = publicAppUrl.trim().endsWith("/") ? publicAppUrl.trim() : `${publicAppUrl.trim()}/`
  return new URL(`/console/skill-repositories/${encodeURIComponent(repositoryId)}`, base).toString()
}

function normalizeDashedIdentifier(value: string, label: string, maxLength: number): string {
  const normalized = value.trim().toLowerCase()
  if (!normalized) throw new Error(`${label}不能为空。`)
  if (normalized.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符。`)
  if (normalized.includes(".")) throw new Error(`${label}不能包含点。`)
  if (!nameBoundaryPattern.test(normalized)) throw new Error(`${label}必须以字母或数字开头和结尾。`)
  if (!namePattern.test(normalized)) throw new Error(`${label}必须以字母或数字开头和结尾，只能包含小写字母、数字和连字符。`)
  if (windowsReservedNames.test(normalized)) throw new Error(`${label}不能使用 Windows 保留名称。`)
  return normalized
}
