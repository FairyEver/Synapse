/** 同步关系状态；CommonJS 入口由构建脚本从本文件生成。 */
export const DRIVE_SYNC_BINDING_STATUSES = ["initializing", "active", "paused", "conflict", "error", "removed"] as const

/** 单次批量读取的最大云盘条目数。 */
export const DRIVE_ITEM_BATCH_LIMIT = 100
/** 单次批量读取的最大独立同步游标数。 */
export const DRIVE_CHANGE_BATCH_LIMIT = 20
/** 每个同步游标单页允许返回的最大变更数。 */
export const DRIVE_CHANGE_BATCH_PAGE_LIMIT = 100

export const DRIVE_SYNC_OPERATION_STATUSES = ["pending", "running", "succeeded", "retry_wait", "conflict", "error"] as const

export const DRIVE_SYNC_OPERATION_KINDS = [
  "download",
  "upload",
  "delete_local",
  "delete_remote",
  "move_local",
  "move_remote",
  "scan",
  "resync",
] as const

export const DRIVE_SYNC_INITIAL_DIRECTIONS = ["remote_to_local", "local_to_remote", "bind_existing"] as const
export const DRIVE_SYNC_BINDING_PREVIEW_STATUSES = ["ready", "blocked", "warning"] as const
export const DRIVE_SYNC_CONFLICT_RESOLUTIONS = ["keep_local", "keep_remote", "keep_both", "confirm_delete", "skip"] as const
export const DRIVE_SYNC_HEALTH_STATUSES = ["idle", "syncing", "retrying", "paused", "error"] as const
