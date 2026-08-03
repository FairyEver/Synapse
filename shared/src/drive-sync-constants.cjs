/** @type {readonly ["initializing", "active", "paused", "conflict", "error", "removed"]} */
exports.DRIVE_SYNC_BINDING_STATUSES = ["initializing", "active", "paused", "conflict", "error", "removed"]

/** @type {readonly ["pending", "running", "succeeded", "retry_wait", "conflict", "error"]} */
exports.DRIVE_SYNC_OPERATION_STATUSES = ["pending", "running", "succeeded", "retry_wait", "conflict", "error"]

/** @type {readonly ["download", "upload", "delete_local", "delete_remote", "move_local", "move_remote", "scan", "resync"]} */
exports.DRIVE_SYNC_OPERATION_KINDS = [
  "download",
  "upload",
  "delete_local",
  "delete_remote",
  "move_local",
  "move_remote",
  "scan",
  "resync",
]

/** @type {readonly ["remote_to_local", "local_to_remote", "bind_existing"]} */
exports.DRIVE_SYNC_INITIAL_DIRECTIONS = ["remote_to_local", "local_to_remote", "bind_existing"]

/** @type {readonly ["ready", "blocked", "warning"]} */
exports.DRIVE_SYNC_BINDING_PREVIEW_STATUSES = ["ready", "blocked", "warning"]

/** @type {readonly ["keep_local", "keep_remote", "keep_both", "confirm_delete", "skip"]} */
exports.DRIVE_SYNC_CONFLICT_RESOLUTIONS = ["keep_local", "keep_remote", "keep_both", "confirm_delete", "skip"]

/** @type {readonly ["idle", "syncing", "retrying", "paused", "error"]} */
exports.DRIVE_SYNC_HEALTH_STATUSES = ["idle", "syncing", "retrying", "paused", "error"]
