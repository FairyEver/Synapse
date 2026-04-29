import { createHash } from "node:crypto"

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function normalizeActivationCode(code: string): string {
  return code.trim().toUpperCase()
}

export function hashActivationCode(code: string): string {
  return sha256(normalizeActivationCode(code))
}

export function hashDeviceId(deviceId: string): string {
  return sha256(deviceId)
}
