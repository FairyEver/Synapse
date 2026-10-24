import { PrivateStorageProtection } from "../process/private-storage-protection"
import type { PermissionPolicy } from "./permission-guard"

export function createPrivateStorageConstraint(protection: PrivateStorageProtection): PermissionPolicy {
  return { id: "private-storage", async decide(request) {
    return await protection.deniesPath(request.resource, true, request.action.startsWith("fs.")) ? "deny" : "defer-to-next"
  } }
}

/** Check caller-selected filesystem arguments before any domain adapter can read them. */
export async function assertPrivateStorageArguments(protection: PrivateStorageProtection, params: Record<string, unknown>): Promise<void> {
  const seen = new WeakSet<object>()
  let visited = 0
  async function inspect(value: unknown, depth: number, relativePath = false): Promise<void> {
    if (++visited > 10_000 || depth > 32) throw new Error("文件参数过大或层级过深")
    if (typeof value === "string" && await protection.deniesPath(value, true, relativePath)) {
      throw new Error("Synapse 私有存储不允许通过文件工具访问，请使用当前登录用户的邮箱工具。")
    }
    if (!value || typeof value !== "object" || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) { for (const item of value) await inspect(item, depth + 1, relativePath) }
    else for (const [key, item] of Object.entries(value)) await inspect(item, depth + 1, /path|cwd|director(?:y|ies)/i.test(key))
  }
  await inspect(params, 0)
}
