import { randomBytes } from "node:crypto"

export function createDriveShareId(): string {
  return `shr_${randomBytes(24).toString("base64url")}`
}

export function driveStorageKeyForItem(itemId: string): string {
  return `drive/${itemId}`
}

export function isValidDriveItemName(value: string): boolean {
  const name = value.trim()
  if (!name) return false
  if (name.length > 255) return false
  if (name === "." || name === "..") return false
  return !/[\\/]/u.test(name)
}
