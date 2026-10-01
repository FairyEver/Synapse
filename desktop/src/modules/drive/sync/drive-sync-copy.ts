import type {
  DriveSyncBindingDto,
  DriveSyncConflictDto,
  DriveSyncConflictResolutionAction,
  DriveSyncOperationDto,
  DriveSyncOperationKind,
} from "@synapse/shared"

/**
 * 同步功能全部用户可见文案的唯一来源。
 * 组件不拼状态句子，只取这里的函数结果，便于单测锁定产品设计文档第 5.2 节的状态表。
 */

export type DriveSyncTone = "normal" | "attention"

export interface DriveSyncStateText {
  readonly text: string
  readonly tone: DriveSyncTone
}

export type DriveSyncPrimaryActionKind = "conflicts" | "retry" | "resume" | "progress" | "open" | "view"

export interface DriveSyncPrimaryAction {
  readonly kind: DriveSyncPrimaryActionKind
  readonly label: string
  readonly variant: "default" | "outline"
}

type DriveSyncTransferKind = "upload" | "download"

/** 正在进行的同步工作。传输和核对要分开说，核对不是「正在下载 N 个文件」。 */
export interface DriveSyncActiveWork {
  readonly kind: "transfer" | "other"
  readonly direction: DriveSyncTransferKind
  readonly label: string
  readonly fileCount: number
  readonly completedBytes: number
  readonly totalBytes: number | null
  readonly currentPath: string
  readonly percent: number | null
}

const TRANSFER_KINDS: ReadonlySet<string> = new Set(["upload", "download"])

/** 进行中的动作说法，用于「正在上传 / 正在核对 / 正在删除」。 */
function actingLabelOf(kind: DriveSyncOperationKind): string {
  switch (kind) {
    case "upload": return "正在上传"
    case "download": return "正在下载"
    case "scan":
    case "resync": return "正在核对"
    case "delete_local":
    case "delete_remote": return "正在删除"
    case "move_local":
    case "move_remote": return "正在移动"
  }
}

export type DriveSyncFilter = "all" | "active" | "attention" | "paused"

export const DRIVE_SYNC_FILTERS: ReadonlyArray<{ readonly value: DriveSyncFilter; readonly label: string }> = [
  { value: "all", label: "全部" },
  { value: "active", label: "进行中" },
  { value: "attention", label: "需要处理" },
  { value: "paused", label: "已暂停" },
]

function isInFlight(operation: DriveSyncOperationDto): boolean {
  return operation.status === "running" || operation.status === "pending"
}

/** 正在进行的同步工作：是传输还是别的动作、方向、文件数、已传/总字节、当前路径。 */
export function activeWorkOf(
  operations: readonly DriveSyncOperationDto[],
): DriveSyncActiveWork | null {
  const inFlight = operations.filter(isInFlight)
  if (inFlight.length === 0) return null
  const download = inFlight.find((operation) => operation.kind === "download")
  const upload = inFlight.find((operation) => operation.kind === "upload")
  const lead = download ?? upload ?? inFlight[0]
  const transfers = inFlight.filter((operation) => TRANSFER_KINDS.has(operation.kind))
  const isTransfer = TRANSFER_KINDS.has(lead.kind)
  const counted = isTransfer ? transfers : inFlight
  const known = counted.filter((operation) => operation.totalBytes !== null && operation.totalBytes > 0)
  const completedBytes = known.reduce((total, operation) => total + (operation.completedBytes ?? 0), 0)
  const totalBytes = known.length === 0
    ? null
    : known.reduce((total, operation) => total + (operation.totalBytes ?? 0), 0)
  return {
    kind: isTransfer ? "transfer" : "other",
    direction: lead.kind === "upload" ? "upload" : "download",
    label: actingLabelOf(lead.kind),
    fileCount: counted.length,
    completedBytes,
    totalBytes,
    currentPath: lead.relativePath,
    percent: totalBytes && totalBytes > 0 ? Math.min(100, (completedBytes / totalBytes) * 100) : null,
  }
}

/** 正在等待重试的操作。可重试错误由系统自己退避重试，不需要用户介入。 */
export function retryOperationOf(
  operations: readonly DriveSyncOperationDto[],
): DriveSyncOperationDto | null {
  return operations.find((operation) => operation.status === "retry_wait") ?? null
}

export function bindingStateText(
  binding: DriveSyncBindingDto,
  operations: readonly DriveSyncOperationDto[],
  conflicts: readonly DriveSyncConflictDto[],
): DriveSyncStateText {
  const openConflicts = conflicts
  // 状态字段是权威的：error 的绑定即使还留着旧的冲突记录，也该先重试而不是去处理冲突。
  if (binding.status === "error") return { text: "同步出错", tone: "attention" }
  if (binding.status === "conflict" || openConflicts.length > 0) {
    const count = openConflicts.length
    // 「两边都有改动」只对 both_modified 成立；混了删除或类型冲突时只说数量，不说过头的话。
    const allBothModified = openConflicts.every((conflict) => conflict.type === "both_modified")
    return {
      text: allBothModified ? `需要处理 · ${count} 个文件两边都有改动` : `需要处理 · ${count} 个文件`,
      tone: "attention",
    }
  }
  if (binding.status === "paused") return { text: "已暂停 · 不会自动同步", tone: "normal" }
  if (binding.status === "initializing") return { text: "正在准备", tone: "normal" }
  if (binding.status === "removed") return { text: "已移除", tone: "normal" }

  const work = activeWorkOf(operations)
  if (work) {
    return {
      text: work.kind === "transfer" ? `${work.label} ${work.fileCount} 个文件` : work.label,
      tone: "normal",
    }
  }
  const retry = retryOperationOf(operations)
  if (retry) return { text: `同步暂未完成，等待重试（第 ${retry.attemptCount} 次）`, tone: "normal" }
  return { text: `已同步 · ${formatRelativeTime(binding.lastSyncedAt ?? binding.updatedAt)}`, tone: "normal" }
}

export function bindingStateDetail(
  binding: DriveSyncBindingDto,
  operations: readonly DriveSyncOperationDto[],
  conflicts: readonly DriveSyncConflictDto[],
): string {
  if (binding.status === "error") {
    return binding.lastError?.trim()
      || operations.find((operation) => operation.status === "error" && operation.message)?.message
      || "同步已停止，需要处理后才能继续。"
  }
  if (binding.status === "conflict" || conflicts.length > 0) return "选一个版本后继续。"
  if (binding.status === "paused") return `最近同步 ${formatRelativeTime(binding.lastSyncedAt ?? binding.updatedAt)}`
  if (binding.status === "initializing") return "正在比对本机与云盘的内容，完成后自动开始。"
  const work = activeWorkOf(operations)
  if (work) {
    if (work.kind === "other") return work.currentPath ? `${work.currentPath} · 内容多时需要较长时间。` : "内容多时需要较长时间。"
    const size = work.totalBytes !== null
      ? `${formatBytes(work.completedBytes)} / ${formatBytes(work.totalBytes)}`
      : formatBytes(work.completedBytes)
    return work.currentPath ? `${size} · ${work.currentPath}` : size
  }
  const retry = retryOperationOf(operations)
  if (retry) return [retry.relativePath, retry.message || "稍后自动继续。"].filter(Boolean).join(" · ")
  return ""
}

/**
 * 卡片主操作。离线或未登录时不做写操作，需要写操作的状态降级成「查看」，
 * 而不是给出一个点了没反应的按钮。
 */
export function bindingPrimaryAction(
  binding: DriveSyncBindingDto,
  operations: readonly DriveSyncOperationDto[],
  conflicts: readonly DriveSyncConflictDto[],
  readOnly: boolean,
): DriveSyncPrimaryAction {
  // 只读时不做写操作，统一给「查看」并真的打开详情，而不是给一个点了只弹一句提示的按钮。
  if (readOnly) {
    if (binding.status === "error" || binding.status === "conflict" || conflicts.length > 0 || binding.status === "paused") {
      return { kind: "view", label: "查看", variant: "outline" }
    }
  }
  if (binding.status === "error") return { kind: "retry", label: "重试", variant: "default" }
  if (binding.status === "conflict" || conflicts.length > 0) {
    return { kind: "conflicts", label: "处理冲突", variant: "default" }
  }
  if (binding.status === "paused") return { kind: "resume", label: "继续同步", variant: "default" }
  if (binding.status === "initializing" || activeWorkOf(operations) || retryOperationOf(operations)) {
    return { kind: "progress", label: "查看进度", variant: "outline" }
  }
  if (binding.kind === "file") return { kind: "open", label: "在文件夹中显示", variant: "outline" }
  return { kind: "open", label: "打开文件夹", variant: "outline" }
}

/** 云盘文件列表行内标记用的短标签。 */
export function bindingMarkText(
  binding: DriveSyncBindingDto,
  operations: readonly DriveSyncOperationDto[],
  conflicts: readonly DriveSyncConflictDto[],
): DriveSyncStateText {
  const state = bindingStateText(binding, operations, conflicts)
  if (state.tone === "attention") return { text: "需要处理", tone: "attention" }
  if (binding.status === "paused") return { text: "已暂停", tone: "normal" }
  if (binding.status === "initializing") return { text: "正在准备", tone: "normal" }
  const work = activeWorkOf(operations)
  if (work) return { text: work.label.replace(/^正在/, "正在"), tone: "normal" }
  if (retryOperationOf(operations)) return { text: "正在重试", tone: "normal" }
  if (binding.status === "active") return { text: "已同步", tone: "normal" }
  return { text: "已移除", tone: "normal" }
}


/** 实际只会产出三种冲突类型；metadata_mismatch 与 path_conflict 是历史死枚举，兜底显示原值。 */
export function conflictTypeText(type: string): string {
  switch (type) {
    case "both_modified": return "两边都改过"
    case "delete_vs_modify": return "一边删除了，另一边有改动"
    case "type_mismatch": return "一边是文件，一边是文件夹"
    case "metadata_mismatch": return "文件属性不一致"
    case "path_conflict": return "同一位置被两样东西占用"
    default: return type
  }
}

export function conflictResolutionText(action: DriveSyncConflictResolutionAction): string {
  switch (action) {
    case "keep_local": return "用电脑上的"
    case "keep_remote": return "用云盘上的"
    case "keep_both": return "两个都保留"
    case "confirm_delete": return "确认删除"
    case "skip": return "稍后处理"
  }
}

/** 冲突处理完成后的提示，每个动作各说各的，不用一句「已处理冲突」糊过去。 */
export function conflictResolutionToast(action: DriveSyncConflictResolutionAction): string {
  switch (action) {
    case "keep_local": return "已用电脑上的版本"
    case "keep_remote": return "已用云盘上的版本"
    case "keep_both": return "已保留两份"
    case "confirm_delete": return "已确认删除"
    case "skip": return "已留待稍后处理"
  }
}

export function operationKindText(kind: DriveSyncOperationKind): string {
  switch (kind) {
    case "download": return "下载"
    case "upload": return "上传"
    case "delete_local": return "删除本地"
    case "delete_remote": return "删除云端"
    case "move_local": return "移动本地"
    case "move_remote": return "移动云端"
    case "scan": return "核对"
    case "resync": return "重新核对"
  }
}


/** 一条已完成的操作描述成一句人话，用于详情里的「最近活动」。 */
export function operationActivityText(operation: DriveSyncOperationDto): string {
  const path = operation.relativePath || "内容"
  if (operation.message?.trim()) return operation.message.trim()
  switch (operation.kind) {
    case "download": return `已下载 ${path}`
    case "upload": return `已上传 ${path}`
    case "delete_local": return `已删除本地 ${path}（移入回收站）`
    case "delete_remote": return `已删除云端 ${path}（移入回收站）`
    case "move_local": return `已移动本地 ${path}`
    case "move_remote": return `已移动云端 ${path}`
    case "scan": return `已核对 ${path}`
    case "resync": return `已重新核对 ${path}`
  }
}

export function isBindingInFilter(
  binding: DriveSyncBindingDto,
  operations: readonly DriveSyncOperationDto[],
  conflicts: readonly DriveSyncConflictDto[],
  filter: DriveSyncFilter,
): boolean {
  switch (filter) {
    case "all": return true
    case "paused": return binding.status === "paused"
    case "attention": return binding.status === "conflict" || binding.status === "error" || conflicts.length > 0
    case "active": return binding.status === "initializing"
      || (binding.status === "active" && (activeWorkOf(operations) !== null || retryOperationOf(operations) !== null))
  }
}

export interface DriveSyncFilterCounts {
  readonly all: number
  readonly active: number
  readonly attention: number
  readonly paused: number
}

export function filterCounts(
  bindings: readonly DriveSyncBindingDto[],
  operations: readonly DriveSyncOperationDto[],
  conflicts: readonly DriveSyncConflictDto[],
): DriveSyncFilterCounts {
  const count = (filter: DriveSyncFilter) => bindings.filter((binding) => isBindingInFilter(
    binding,
    operations.filter((operation) => operation.bindingId === binding.id),
    conflicts.filter((conflict) => conflict.bindingId === binding.id),
    filter,
  )).length
  return { all: bindings.length, active: count("active"), attention: count("attention"), paused: count("paused") }
}

/** 异步任务的状态词。用于顶栏按钮的无障碍标签，不进正文。 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export function formatRelativeTime(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return "尚未同步"
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return "尚未同步"
  const diff = now.getTime() - at.getTime()
  if (diff < 0) return formatClock(at, now)
  if (diff < MINUTE) return "刚刚"
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`
  if (isSameDay(at, now)) return `今天 ${pad(at.getHours())}:${pad(at.getMinutes())}`
  const yesterday = new Date(now.getTime() - 24 * HOUR)
  if (isSameDay(at, yesterday)) return `昨天 ${pad(at.getHours())}:${pad(at.getMinutes())}`
  if (at.getFullYear() === now.getFullYear()) return `${at.getMonth() + 1} 月 ${at.getDate()} 日`
  return `${at.getFullYear()} 年 ${at.getMonth() + 1} 月 ${at.getDate()} 日`
}

function formatClock(at: Date, now: Date): string {
  return isSameDay(at, now) ? `今天 ${pad(at.getHours())}:${pad(at.getMinutes())}` : "刚刚"
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** 按名称、本地路径和云端路径匹配同步关系。 */
export function matchesDriveSyncSearch(binding: DriveSyncBindingDto, query: string): boolean {
  const keyword = query.trim().toLocaleLowerCase()
  return !keyword || [binding.driveItemName, binding.localPath, binding.drivePathHint ?? ""]
    .some((value) => value.toLocaleLowerCase().includes(keyword))
}
