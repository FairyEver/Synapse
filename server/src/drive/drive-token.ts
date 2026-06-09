import { randomBytes } from "node:crypto"

export function createDriveShareId(): string {
  return `shr_${randomBytes(24).toString("base64url")}`
}

export function createDrivePublishId(): string {
  return `pub_${randomBytes(24).toString("base64url")}`
}

export function driveStorageKeyForItem(itemId: string): string {
  return `drive/${itemId}`
}

export function drivePublicationStorageKey(input: {
  readonly publicationId: string
  readonly deploymentId: string
  readonly relativePath: string
}): string {
  const relativePath = normalizePublicationRelativePath(input.relativePath)
  return `drive-publications/${input.publicationId}/${input.deploymentId}/${relativePath}`
}

export function normalizePublicationRelativePath(value: string): string {
  const normalized = value.replace(/\\/gu, "/").replace(/^\/+/u, "")
  const parts = normalized.split("/").filter(Boolean)
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Invalid drive publication relative path.")
  }
  return parts.join("/")
}

export function isValidDriveItemName(value: string): boolean {
  const name = value.trim()
  if (!name) return false
  if (name.length > 255) return false
  if (name === "." || name === "..") return false
  return !/[\\/]/u.test(name)
}
