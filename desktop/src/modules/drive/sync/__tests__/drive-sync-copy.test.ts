import { describe, expect, it } from "vitest"
import type {
  DriveSyncBindingDto,
  DriveSyncConflictDto,
  DriveSyncOperationDto,
} from "@synapse/shared"
import {
  activeTransferOf,
  bindingMarkText,
  bindingPrimaryAction,
  bindingStateDetail,
  bindingStateText,
  conflictResolutionText,
  conflictTypeText,
  filterCounts,
  formatBytes,
  formatRelativeTime,
  isBindingInFilter,
  operationKindText,
  retryOperationOf,
} from "../drive-sync-copy"

const NOW = new Date("2026-09-30T15:00:00.000Z")

function binding(overrides: Partial<DriveSyncBindingDto> = {}): DriveSyncBindingDto {
  return {
    id: "binding-1",
    driveItemId: "drive-item-1",
    driveItemName: "项目A",
    drivePathHint: "/项目/项目A",
    kind: "folder",
    localPath: "/Users/me/Documents/项目A",
    status: "active",
    remoteCursor: null,
    excludeRules: { forced: [], defaults: [], importedGitignore: [], user: [] },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-30T06:00:00.000Z",
    lastSyncedAt: "2026-09-30T14:58:00.000Z",
    lastError: null,
    ...overrides,
  }
}

function operation(overrides: Partial<DriveSyncOperationDto> = {}): DriveSyncOperationDto {
  return {
    id: "operation-1",
    bindingId: "binding-1",
    kind: "upload",
    relativePath: "docs/需求.md",
    status: "running",
    message: null,
    attemptCount: 1,
    nextRetryAt: null,
    completedBytes: 4,
    totalBytes: 10,
    updatedAt: "2026-09-30T14:59:00.000Z",
    ...overrides,
  }
}

function conflict(overrides: Partial<DriveSyncConflictDto> = {}): DriveSyncConflictDto {
  return {
    id: "conflict-1",
    bindingId: "binding-1",
    relativePath: "docs/需求.md",
    type: "both_modified",
    localSummary: "今天 14:32 · 1.3 MB",
    remoteSummary: "今天 14:30 · 1.2 MB",
    availableActions: ["keep_local", "keep_remote"],
    createdAt: "2026-09-30T14:59:00.000Z",
    ...overrides,
  }
}

describe("同步状态文案", () => {
  it("正在准备：初始化中的同步不被称为健康状态", () => {
    const state = bindingStateText(binding({ status: "initializing" }), [], [])
    expect(state).toEqual({ text: "正在准备", tone: "normal" })
    expect(bindingStateDetail(binding({ status: "initializing" }), [], []))
      .toBe("正在比对本机与云盘的内容，完成后自动开始。")
  })

  it("正在上传 / 正在下载：带文件数", () => {
    const uploading = bindingStateText(
      binding(),
      [operation({ kind: "upload" }), operation({ id: "operation-2", kind: "upload" })],
      [],
    )
    expect(uploading.text).toBe("正在上传 2 个文件")

    const downloading = bindingStateText(binding(), [operation({ kind: "download" })], [])
    expect(downloading.text).toBe("正在下载 1 个文件")
  })

  it("等待重试：说明是第几次，且不需要用户介入", () => {
    const state = bindingStateText(
      binding(),
      [operation({ status: "retry_wait", attemptCount: 3 })],
      [],
    )
    expect(state).toEqual({ text: "网络不稳定，正在重试（第 3 次）", tone: "normal" })
    expect(bindingStateDetail(binding(), [operation({ status: "retry_wait", relativePath: "课件/第 3 讲.pdf" })], []))
      .toBe("课件/第 3 讲.pdf · 稍后自动继续。")
  })

  it("已同步：带相对时间", () => {
    // 状态句读的是真实时钟，这里只锁形态；具体时刻由 formatRelativeTime 的用例精确锁定。
    const state = bindingStateText(binding(), [], [])
    expect(state.tone).toBe("normal")
    expect(state.text).toMatch(/^已同步 · \S/)
  })

  it("已暂停：说明不会自动同步", () => {
    expect(bindingStateText(binding({ status: "paused" }), [], []))
      .toEqual({ text: "已暂停 · 不会自动同步", tone: "normal" })
  })

  it("需要处理：只有全是两边都改过时才说「两边都有改动」", () => {
    const bothModified = bindingStateText(
      binding({ status: "conflict" }),
      [],
      [conflict(), conflict({ id: "conflict-2" })],
    )
    expect(bothModified).toEqual({ text: "需要处理 · 2 个文件两边都有改动", tone: "attention" })

    const mixed = bindingStateText(
      binding({ status: "conflict" }),
      [],
      [conflict(), conflict({ id: "conflict-2", type: "type_mismatch" })],
    )
    expect(mixed).toEqual({ text: "需要处理 · 2 个文件", tone: "attention" })
  })

  it("需要处理：状态还是 active 但已有冲突时同样算需要处理", () => {
    const state = bindingStateText(binding({ status: "active" }), [], [conflict()])
    expect(state.tone).toBe("attention")
    expect(state.text).toBe("需要处理 · 1 个文件两边都有改动")
  })

  it("同步出错：用服务端给出的原因，缺省时给一句兜底", () => {
    expect(bindingStateText(binding({ status: "error" }), [], []))
      .toEqual({ text: "同步出错", tone: "attention" })
    expect(bindingStateDetail(binding({ status: "error", lastError: "找不到本地文件夹，磁盘可能没有连接" }), [], []))
      .toBe("找不到本地文件夹，磁盘可能没有连接")
    expect(bindingStateDetail(binding({ status: "error", lastError: null }), [], []))
      .toBe("同步已停止，需要处理后才能继续。")
  })
})

describe("云盘行内标记", () => {
  it("用短标签，不把状态整句塞进行内", () => {
    expect(bindingMarkText(binding({ status: "active" }), [], []).text).toBe("已同步")
    expect(bindingMarkText(binding(), [operation({ kind: "upload" })], []).text).toBe("正在上传")
    expect(bindingMarkText(binding(), [operation({ kind: "download" })], []).text).toBe("正在下载")
    expect(bindingMarkText(binding({ status: "initializing" }), [], []).text).toBe("正在准备")
    expect(bindingMarkText(binding({ status: "paused" }), [], []).text).toBe("已暂停")
    expect(bindingMarkText(binding(), [operation({ status: "retry_wait" })], []).text).toBe("正在重试")
  })

  it("需要处理的行内标记用警示语气，且不含具体数量", () => {
    const mark = bindingMarkText(binding({ status: "conflict" }), [], [conflict()])
    expect(mark).toEqual({ text: "需要处理", tone: "attention" })
    expect(bindingMarkText(binding({ status: "error" }), [], []).tone).toBe("attention")
  })
})

describe("主操作", () => {
  it("按状态给不同的主操作", () => {
    expect(bindingPrimaryAction(binding(), [], [], false)).toEqual({ kind: "open", label: "打开文件夹", variant: "outline" })
    expect(bindingPrimaryAction(binding({ status: "paused" }), [], [], false))
      .toEqual({ kind: "resume", label: "继续同步", variant: "default" })
    expect(bindingPrimaryAction(binding({ status: "error" }), [], [], false))
      .toEqual({ kind: "retry", label: "重试", variant: "default" })
    expect(bindingPrimaryAction(binding({ status: "conflict" }), [], [conflict()], false))
      .toEqual({ kind: "conflicts", label: "处理冲突", variant: "default" })
    expect(bindingPrimaryAction(binding({ status: "initializing" }), [], [], false))
      .toEqual({ kind: "progress", label: "查看进度", variant: "outline" })
    expect(bindingPrimaryAction(binding(), [operation({ status: "retry_wait" })], [], false))
      .toEqual({ kind: "progress", label: "查看进度", variant: "outline" })
  })

  it("离线只读：需要写操作的主操作降级成「查看」，不给出点了没反应的按钮", () => {
    expect(bindingPrimaryAction(binding({ status: "paused" }), [], [], true))
      .toEqual({ kind: "resume", label: "查看", variant: "outline" })
    expect(bindingPrimaryAction(binding({ status: "error" }), [], [], true))
      .toEqual({ kind: "retry", label: "查看", variant: "outline" })
    expect(bindingPrimaryAction(binding({ status: "conflict" }), [], [conflict()], true))
      .toEqual({ kind: "conflicts", label: "查看", variant: "outline" })
  })
})

describe("筛选", () => {
  const bindings = [
    binding({ id: "b1", status: "active" }),
    binding({ id: "b2", status: "conflict" }),
    binding({ id: "b3", status: "paused" }),
    binding({ id: "b4", status: "error" }),
    binding({ id: "b5", status: "initializing" }),
    binding({ id: "b6", status: "active" }),
  ]
  const operations = [operation({ bindingId: "b6", status: "running" })]
  const conflicts = [conflict({ bindingId: "b2" })]

  it("四类计数", () => {
    expect(filterCounts(bindings, operations, conflicts))
      .toEqual({ all: 6, active: 2, attention: 2, paused: 1 })
  })

  it("进行中只含初始化中和真的在传输或重试的", () => {
    const idle = binding({ id: "b9", status: "active" })
    expect(isBindingInFilter(idle, [], [], "active")).toBe(false)
    expect(isBindingInFilter(binding({ id: "b5", status: "initializing" }), [], [], "active")).toBe(true)
    expect(isBindingInFilter(idle, [operation({ bindingId: "b9", status: "running" })], [], "active")).toBe(true)
    expect(isBindingInFilter(idle, [operation({ bindingId: "b9", status: "retry_wait" })], [], "active")).toBe(true)
  })

  it("需要处理不含已暂停", () => {
    expect(isBindingInFilter(binding({ status: "paused" }), [], [], "attention")).toBe(false)
    expect(isBindingInFilter(binding({ status: "active" }), [], [conflict()], "attention")).toBe(true)
  })
})

describe("传输进度", () => {
  it("汇总进行中操作的字节数并给出百分比", () => {
    const transfer = activeTransferOf([
      operation({ id: "o1", completedBytes: 4, totalBytes: 10 }),
      operation({ id: "o2", completedBytes: 6, totalBytes: 10 }),
    ])
    expect(transfer).toEqual({
      direction: "upload",
      fileCount: 2,
      completedBytes: 10,
      totalBytes: 20,
      currentPath: "docs/需求.md",
      percent: 50,
    })
  })

  it("没有进行中的操作时为 null，不会凭空造出进度", () => {
    expect(activeTransferOf([])).toBeNull()
    expect(activeTransferOf([operation({ status: "succeeded" })])).toBeNull()
    expect(retryOperationOf([operation({ status: "succeeded" })])).toBeNull()
  })

  it("总字节未知时不给出百分比", () => {
    const transfer = activeTransferOf([operation({ completedBytes: 4, totalBytes: null })])
    expect(transfer?.totalBytes).toBeNull()
    expect(transfer?.percent).toBeNull()
  })
})

describe("术语对照", () => {
  it("冲突类型只说人话", () => {
    expect(conflictTypeText("both_modified")).toBe("两边都改过")
    expect(conflictTypeText("delete_vs_modify")).toBe("一边删除了，另一边有改动")
    expect(conflictTypeText("type_mismatch")).toBe("一边是文件，一边是文件夹")
  })

  it("解决动作不出现「用本地 / 用云端」", () => {
    expect(conflictResolutionText("keep_local")).toBe("用电脑上的")
    expect(conflictResolutionText("keep_remote")).toBe("用云盘上的")
    expect(conflictResolutionText("keep_both")).toBe("两个都保留")
    expect(conflictResolutionText("confirm_delete")).toBe("确认删除")
    expect(conflictResolutionText("skip")).toBe("稍后处理")
  })

  it("操作类型与用户动作对齐", () => {
    expect(operationKindText("download")).toBe("下载")
    expect(operationKindText("delete_remote")).toBe("删除云端")
    expect(operationKindText("resync")).toBe("重新核对")
  })
})

describe("时间与体积", () => {
  it("相对时间按区间选择说法", () => {
    const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()
    expect(formatRelativeTime(at(-30_000), NOW)).toBe("刚刚")
    expect(formatRelativeTime(at(-5 * 60_000), NOW)).toBe("5 分钟前")
    expect(formatRelativeTime(at(-59 * 60_000), NOW)).toBe("59 分钟前")
    // 同一天与前一天用时钟表示，时钟按本地时区渲染，这里只锁分支不锁具体时刻。
    expect(formatRelativeTime(at(-3 * 60 * 60_000), NOW)).toMatch(/^今天 \d{2}:\d{2}$/)
    expect(formatRelativeTime(at(-25 * 60 * 60_000), NOW)).toMatch(/^昨天 \d{2}:\d{2}$/)
    expect(formatRelativeTime(at(-5 * 24 * 60 * 60_000), NOW)).toMatch(/^\d+ 月 \d+ 日$/)
    expect(formatRelativeTime(null, NOW)).toBe("尚未同步")
    expect(formatRelativeTime("not-a-date", NOW)).toBe("尚未同步")
  })

  it("体积", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1024)).toBe("1.0 KB")
    expect(formatBytes(1024 * 1024 * 342)).toBe("342 MB")
  })
})
