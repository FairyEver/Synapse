import { z } from "zod"
import { DRIVE_ITEM_BATCH_LIMIT, DRIVE_CHANGE_BATCH_LIMIT, DRIVE_CHANGE_BATCH_PAGE_LIMIT } from "@synapse/shared/drive-sync-constants"

const id = z.string().min(1).max(128)
const sequence = z.string().refine((value) => /^\d{1,20}$/u.test(value) && BigInt(value) <= 9223372036854775807n)
export const driveBatchErrorSchema = z.object({ status: z.number().int().min(400).max(599), code: z.string(), message: z.string(), retryAfterMs: z.number().finite().nonnegative().optional() })
const ancestor = z.object({ id, parentId: id.nullable(), name: z.string(), type: z.enum(["file", "folder"]) })
const item = ancestor.extend({
  size: z.string().regex(/^\d+$/u), mimeType: z.string().nullable(), storageStatus: z.enum(["pending", "active", "delete_pending", "deleted", "failed"]),
  shared: z.boolean(), activeShareId: z.string().nullable().optional(),
  activeShare: z.object({ id: z.string(), passwordEnabled: z.boolean(), expiresAt: z.string().nullable(), accessMode: z.enum(["link_read", "link_edit", "specified_users_edit"]), editorCount: z.number().int().nonnegative() }).nullable().optional(),
  createdAt: z.string(), updatedAt: z.string(),
})
export const driveItemBatchResponseSchema = z.object({ results: z.array(z.object({
  itemId: id, error: driveBatchErrorSchema.nullable(),
  data: z.object({ item, ancestors: z.array(ancestor).max(255), currentVersionId: id.nullable(), etag: z.string().nullable() }).nullable(),
})).max(DRIVE_ITEM_BATCH_LIMIT) }).superRefine(({ results }, ctx) => {
  for (const result of results) {
    if (Boolean(result.data) === Boolean(result.error)) ctx.addIssue({ code: "custom", message: "Invalid item result" })
    if (!result.data) continue
    const { item, ancestors } = result.data
    const seen = new Set([item.id])
    let parentId = item.parentId
    for (const parent of [...ancestors].reverse()) {
      if (parent.id !== parentId || parent.type !== "folder" || seen.has(parent.id)) ctx.addIssue({ code: "custom", message: "Invalid ancestry" })
      seen.add(parent.id)
      parentId = parent.parentId
    }
    if (item.id !== result.itemId || parentId !== null) ctx.addIssue({ code: "custom", message: "Incomplete ancestry" })
  }
})
const change = z.object({
  id, sequence, itemId: id, parentId: id.nullable(),
  type: z.enum(["created", "content_updated", "renamed", "moved", "trashed", "restored", "deleted"]),
  versionId: id.nullable().optional(), etag: z.string().nullable().optional(), name: z.string().nullable().optional(),
  pathHint: z.string().nullable().optional(), currentPathHint: z.string().nullable().optional(), itemKind: z.enum(["file", "folder"]).nullable().optional(), actor: z.string().nullable().optional(), occurredAt: z.string(),
})
export const driveChangeBatchResponseSchema = z.object({ results: z.array(z.object({
  requestId: id, error: driveBatchErrorSchema.nullable(),
  data: z.object({ items: z.array(change).max(DRIVE_CHANGE_BATCH_PAGE_LIMIT), nextCursor: sequence.nullable(), hasMore: z.boolean(), resyncRequired: z.boolean() }).nullable(),
})).max(DRIVE_CHANGE_BATCH_LIMIT) }).superRefine(({ results }, ctx) => {
  for (const { data, error } of results) {
    if (Boolean(data) === Boolean(error) || (data?.hasMore && (!data.items.length || data.resyncRequired))) ctx.addIssue({ code: "custom", message: "Invalid change result" })
  }
})

export function assertDriveBatchKeys(actual: readonly string[], expected: readonly string[]): void {
  const keys = new Set(actual)
  if (keys.size !== actual.length || actual.length !== expected.length || expected.some((key) => !keys.has(key))) {
    throw Object.assign(new Error("云盘批量响应不完整，请稍后重试。"), { status: 502 })
  }
}
