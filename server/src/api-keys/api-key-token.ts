import { createHash, randomBytes } from "node:crypto"

const apiKeyPrefix = "syn_sk_"
const visibleRandomCharacterCount = 8
/** 开放 API 契约用它把密钥形状写进文档，和这里的校验保持同一份定义。 */
export const apiKeySecretPatternSource = `^${apiKeyPrefix}[A-Za-z0-9_-]{43}$`
const apiKeySecretPattern = new RegExp(apiKeySecretPatternSource, "u")

type RandomBytes = (size: number) => Buffer

export function createApiKeySecret(random: RandomBytes = randomBytes): string {
  return `${apiKeyPrefix}${random(32).toString("base64url")}`
}

export function hashApiKeySecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex")
}

export function getApiKeyPrefix(secret: string): string {
  return secret.slice(0, apiKeyPrefix.length + visibleRandomCharacterCount)
}

export function isApiKeySecret(value: string): boolean {
  return apiKeySecretPattern.test(value)
}
