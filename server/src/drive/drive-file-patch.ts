import type { DriveFileContentPatchInput, DriveFileContentPatchOperation } from "@synapse/shared"

export type DriveFilePatchOperation = DriveFileContentPatchOperation
export type DriveFilePatchInput = DriveFileContentPatchInput

export type DriveFilePatchApplied = { readonly operationIndex: number; readonly startByte: number; readonly endByte: number }

export class DriveFilePatchError extends Error {
  constructor(readonly code: string, message: string, readonly details?: Record<string, number>) {
    super(message)
    this.name = "DriveFilePatchError"
  }
}

type Located = { readonly index: number; readonly start: number; readonly end: number; readonly text: string }

export function applyDriveFilePatch(base: string, operations: readonly DriveFilePatchOperation[]): {
  readonly text: string
  readonly sizeBytes: number
  readonly applied: readonly DriveFilePatchApplied[]
} {
  if (operations.length === 0 || operations.length > 10) throw new DriveFilePatchError("DRIVE_FILE_PATCH_INVALID", "补丁需要 1 到 10 项操作。")
  let addedBytes = 0
  const located: Located[] = []
  const appends: Located[] = []
  for (const [index, operation] of operations.entries()) {
    addedBytes += Buffer.byteLength(operation.text, "utf8")
    if (addedBytes > 64 * 1024) throw new DriveFilePatchError("DRIVE_FILE_PATCH_INVALID", "单次新增文本不能超过 64 KiB。")
    if (operation.type === "append") {
      appends.push({ index, start: base.length, end: base.length, text: operation.text })
      continue
    }
    const { exact, prefix = "", suffix = "" } = operation.target
    if (!exact || Buffer.byteLength(exact, "utf8") > 16 * 1024) {
      throw new DriveFilePatchError("DRIVE_FILE_PATCH_TOO_BROAD", "单个精确目标不能超过 16 KiB。")
    }
    const matches: number[] = []
    for (let from = 0; from <= base.length - exact.length;) {
      const position = base.indexOf(exact, from)
      if (position < 0) break
      if (base.slice(Math.max(0, position - prefix.length), position) === prefix && base.slice(position + exact.length, position + exact.length + suffix.length) === suffix) {
        matches.push(position)
        if (matches.length > 1) break
      }
      from = position + 1
    }
    if (matches.length === 0) throw new DriveFilePatchError("DRIVE_FILE_PATCH_TARGET_NOT_FOUND", `第 ${index + 1} 项目标未找到，请重新读取并定位。`)
    if (matches.length > 1) throw new DriveFilePatchError("DRIVE_FILE_PATCH_TARGET_AMBIGUOUS", `第 ${index + 1} 项目标不唯一，请增加上下文。`)
    const match = matches[0]!
    located.push(operation.type === "insert_before"
      ? { index, start: match, end: match, text: operation.text }
      : operation.type === "insert_after"
        ? { index, start: match + exact.length, end: match + exact.length, text: operation.text }
        : { index, start: match, end: match + exact.length, text: operation.text })
  }
  located.sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index)
  for (let index = 1; index < located.length; index++) {
    const previous = located[index - 1]!
    const current = located[index]!
    if (current.start < previous.end || current.start === previous.start) {
      throw new DriveFilePatchError("DRIVE_FILE_PATCH_OVERLAP", "补丁目标相互重叠，请重新定位。")
    }
  }
  const parts: string[] = []
  const applied: DriveFilePatchApplied[] = []
  let position = 0
  let outputBytes = 0
  for (const operation of [...located, ...appends]) {
    const untouched = base.slice(position, operation.start)
    parts.push(untouched, operation.text)
    outputBytes += Buffer.byteLength(untouched, "utf8")
    const startByte = outputBytes
    outputBytes += Buffer.byteLength(operation.text, "utf8")
    applied.push({ operationIndex: operation.index, startByte, endByte: outputBytes })
    position = operation.end
  }
  const tail = base.slice(position)
  parts.push(tail)
  outputBytes += Buffer.byteLength(tail, "utf8")
  const baseBytes = Buffer.byteLength(base, "utf8")
  if (baseBytes - outputBytes >= 1024 && outputBytes * 2 < baseBytes) {
    throw new DriveFilePatchError("DRIVE_FILE_PATCH_TOO_BROAD", "补丁会大幅缩短文件；明确整篇改写时，请下载固定版本并用 file_upload(expectedVersionId) 提交。", { baseSizeBytes: baseBytes, proposedSizeBytes: outputBytes })
  }
  return { text: parts.join(""), sizeBytes: outputBytes, applied: applied.sort((a, b) => a.operationIndex - b.operationIndex) }
}
