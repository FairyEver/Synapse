import { randomBytes } from "node:crypto"

export function createDriveShareId(): string {
  return `shr_${randomBytes(24).toString("base64url")}`
}

export function driveStorageKeyForItem(itemId: string): string {
  return `drive/${itemId}`
}

export function driveOverwriteStorageKeyForSession(itemId: string, sessionId: string): string {
  return `drive/${itemId}/overwrites/${sessionId}`
}

export function isValidDriveItemName(value: string): boolean {
  const name = value.normalize("NFC")
  if (!name) return false
  if (name !== name.trim()) return false
  if (name.length > 255) return false
  if (name === "." || name === "..") return false
  if (/[<>:"/\\|?*\x00-\x1f]/u.test(name)) return false
  if (/[. ]$/u.test(name)) return false
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(name)) return false
  return true
}
