import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

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
  const base = publicAppUrl.trim().replace(/\/+$/u, "")
  return `${base}/webhooks/${encodeURIComponent(publicId)}/${encodeURIComponent(secret)}`
}

export function maskWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split("/")
    if (parts.length >= 4 && parts[1] === "webhooks") {
      parts[3] = "***"
      parsed.pathname = parts.join("/")
      return parsed.toString()
    }
  } catch {
    return maskWebhookPath(url)
  }
  return maskWebhookPath(url)
}

function maskWebhookPath(value: string): string {
  return value.replace(/\/webhooks\/([^/]+)\/[^/?#]+/u, "/webhooks/$1/***")
}
