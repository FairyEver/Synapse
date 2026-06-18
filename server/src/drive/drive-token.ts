import { randomBytes } from "node:crypto"

const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

export function createDriveShareId(): string {
  return `shr_${randomBytes(24).toString("base64url")}`
}

export function createDrivePublicAssetId(): string {
  const bytes = randomBytes(32)
  let suffix = ""
  for (let index = 0; index < 32; index += 1) {
    suffix += BASE62_ALPHABET[bytes[index]! % BASE62_ALPHABET.length]
  }
  return `asset_${suffix}`
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
