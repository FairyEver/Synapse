import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import {
  buildWebhookUrl as buildSharedWebhookUrl,
} from "@synapse/shared"

export { maskWebhookUrl } from "@synapse/shared"

type RandomBytes = (size: number) => Buffer

export function createWebhookPublicId(random: RandomBytes = randomBytes): string {
  return `wh_${random(24).toString("base64url")}`
}

export function createWebhookSecret(random: RandomBytes = randomBytes): string {
  return `whsec_${random(32).toString("base64url")}`
}

export function hashWebhookSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex")
}

export function verifyWebhookSecret(secret: string, hash: string): boolean {
  if (!/^[a-f0-9]{64}$/iu.test(hash)) return false
  try {
    const expected = Buffer.from(hashWebhookSecret(secret), "hex")
    const stored = Buffer.from(hash, "hex")
    if (stored.length !== expected.length) return false
    return timingSafeEqual(expected, stored)
  } catch {
    return false
  }
}

export function buildWebhookUrl(publicAppUrl: string, publicId: string, secret: string): string {
  return buildSharedWebhookUrl({ publicAppUrl, publicId, secret })
}
