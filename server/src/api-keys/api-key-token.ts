import { createHash, randomBytes } from "node:crypto"

const apiKeyPrefix = "syn_sk_"
const visibleRandomCharacterCount = 8
const apiKeyBodyCharacterClass = "[A-Za-z0-9_-]"
/** 开放 API 契约用它把密钥形状写进文档，和这里的校验保持同一份定义。 */
export const apiKeySecretPatternSource = `^${apiKeyPrefix}${apiKeyBodyCharacterClass}{43}$`
/**
 * 日志脱敏用的形状：不带锚点，且允许比真实密钥更长。
 *
 * 脱敏要在任意文本里（路径、堆栈、错误消息）找到密钥本体，所以不能要求正好 43 位 ——
 * 长度对不上就整段漏出来，比多打码一段更糟。字符集和校验共用同一份定义。
 */
export const apiKeySecretInlinePatternSource = `${apiKeyPrefix}${apiKeyBodyCharacterClass}{43,}`
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
