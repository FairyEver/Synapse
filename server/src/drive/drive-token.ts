import { randomBytes } from "node:crypto"

const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const BASE62_RANDOM_BYTE_LIMIT = Math.floor(256 / BASE62_ALPHABET.length) * BASE62_ALPHABET.length

/**
 * Crockford Base32 —— 大写字母表里没有 I、L、O、U。
 *
 * 分享链接要经过两双容易出错的眼睛：人的，和模型口述时的。两者都会把 `O` 读成
 * `0`、把 `I` 读成 `l`，而 base64url 恰好把这几个字符全放在同一个字母表里。实测
 * 发生过一次：`shr_0VcnIOa08…` 被复述成 `shr_0VcnIOa8…`，少掉的那一位让分享页
 * 404，而库里那条链接一直是好的。这几个字符在字母表里根本不存在，这类混淆就无
 * 从发生。
 *
 * 32 个字符正好对应 5 bit，所以每个随机字节取低 5 位就是满熵，不需要拒绝采样。
 */
const UNAMBIGUOUS_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function createDriveShareId(): string {
  return `shr_${createUnambiguousToken()}`
}

export function createDriveSiteId(): string {
  return `site_${createUnambiguousToken()}`
}

/**
 * 32 个字符，与它替换掉的 `randomBytes(24).toString("base64url")` 等长 —— 长度是
 * 外部契约的一部分（URL 形状、库里的唯一列、各处的 `shr_` 正则），不是实现细节，
 * 所以换字母表不换长度。
 *
 * 换的只是新签发的 id。老链接照旧留在库里，`/share/:shareId` 拿到的字符串直接查
 * 库，没有任何一步靠解码回读它，所以旧链接不受影响。
 */
function createUnambiguousToken(): string {
  return [...randomBytes(32)].map((byte) => UNAMBIGUOUS_ALPHABET[byte & 31]).join("")
}

export function createDrivePublicAssetId(): string {
  return createBase62Id("asset_")
}

export function createDriveDocumentImageId(): string {
  return createBase62Id("img_")
}

function createBase62Id(prefix: string): string {
  let suffix = ""
  while (suffix.length < 32) {
    const bytes = randomBytes(32)
    for (const byte of bytes) {
      if (byte >= BASE62_RANDOM_BYTE_LIMIT) continue
      suffix += BASE62_ALPHABET[byte % BASE62_ALPHABET.length]
      if (suffix.length === 32) break
    }
  }
  return `${prefix}${suffix}`
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
