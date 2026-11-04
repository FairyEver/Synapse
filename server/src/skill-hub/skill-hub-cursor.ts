import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { hubError } from "./skill-hub-error"

const developmentKey = randomBytes(32)
const cursorPayload = z.tuple([z.string(), z.unknown()])

function sign(data: string): Buffer {
  return createHmac("sha256", process.env.USER_ACCESS_JWT_SECRET || developmentKey)
    .update("synapse:skill-hub:cursor:v1:").update(data).digest()
}

export function encodeHubCursor(scope: string, value: unknown): string {
  const data = Buffer.from(JSON.stringify([scope, value])).toString("base64url")
  return `${data}.${sign(data).toString("base64url")}`
}

export function decodeHubCursor<T>(scope: string, token: string, schema: { parse(value: unknown): T }): T {
  try {
    if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error("invalid encoding")
    const [data, signature] = token.split(".")
    const digest = sign(data)
    const supplied = Buffer.from(signature, "base64url")
    if (supplied.length !== digest.length || !timingSafeEqual(digest, supplied)) throw new Error("invalid signature")
    const [boundScope, value] = cursorPayload.parse(JSON.parse(Buffer.from(data, "base64url").toString("utf8")))
    if (boundScope !== scope) throw new Error("scope changed")
    return schema.parse(value)
  } catch {
    throw hubError(400, "HUB_INVALID_CURSOR", "游标无效或查询范围已变化，请从第一页重新读取。")
  }
}
