// 主进程和文件列表共用同一套排除语义，避免列表把引擎忽略的条目标成同步。
export {
  DRIVE_SYNC_FORCED_EXCLUDES,
  DRIVE_SYNC_DEFAULT_EXCLUDES,
  createDefaultDriveSyncExcludeRules,
  isDriveSyncExcluded,
  hasDriveSyncIncludedDescendant,
  parseGitignoreForDriveSync,
} from "../../src/lib/drive-sync-excludes"
