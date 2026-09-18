import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * 本机暂存「还没传走」的分片。
 *
 * 分片在发出去**之前**先落盘、服务端确认之后再删掉，所以这个目录里躺着的永远恰好是
 * 尚未确认的那几片。进程中途被杀、电脑合上，重新进来时这些分片还在，可以接着完成——
 * 没有这一步，最后一片会随着进程一起消失，而它恰恰是「完成」时要补的那一片。
 *
 * 目录名由 recordingId 决定而不是随机：重启之后还要能找回同一段录音的暂存。
 * 位置沿用既有约定，`os.tmpdir()` 下的 `synapse-<用途>-` 前缀目录。
 */

const SPOOL_PREFIX = "synapse-meeting-recording-"

/** 超过这个时间没人碰过的暂存目录视为废弃。 */
export const STALE_SPOOL_AGE_MS = 24 * 60 * 60 * 1000

export type MeetingSpool = {
  readonly directory: string
  /** 落盘。必须在发出网络请求之前完成。 */
  stage(partNumber: number, bytes: Uint8Array): Promise<void>
  /** 服务端确认之后删掉本地副本。 */
  confirm(partNumber: number): Promise<void>
  /** 还没确认的分片，按编号升序。 */
  pending(): Promise<readonly { readonly partNumber: number; readonly bytes: Uint8Array }[]>
  /** 整段录音收尾，把暂存目录清掉。 */
  clear(): Promise<void>
}

/**
 * 把 recordingId 收成一个纯粹的目录名。
 *
 * 分隔符一律换掉，所以结果永远是**单个路径片段**，拼不出第二层目录；而目录名又固定
 * 带着前缀，`..` 这样的值也变不成真正的上级引用。两道加起来才叫安全，单独的字符替
 * 换挡不住 `..` 本身。
 */
function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "_")
}

export function meetingSpoolRoot(): string {
  return os.tmpdir()
}

export function meetingSpoolDirectory(recordingId: string, root: string = meetingSpoolRoot()): string {
  return path.join(root, `${SPOOL_PREFIX}${safeSegment(recordingId)}`)
}

function partFileName(partNumber: number): string {
  return `${String(partNumber).padStart(6, "0")}.part`
}

export function createMeetingSpool(recordingId: string, root: string = meetingSpoolRoot()): MeetingSpool {
  const directory = meetingSpoolDirectory(recordingId, root)

  return {
    directory,
    async stage(partNumber: number, bytes: Uint8Array) {
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, partFileName(partNumber)), bytes)
    },
    async confirm(partNumber: number) {
      await rm(path.join(directory, partFileName(partNumber)), { force: true })
    },
    async pending() {
      let names: string[]
      try {
        names = await readdir(directory)
      } catch {
        return []
      }
      const parts: { partNumber: number; bytes: Uint8Array }[] = []
      for (const name of names.filter((entry) => entry.endsWith(".part")).sort()) {
        const partNumber = Number.parseInt(name.slice(0, -".part".length), 10)
        if (!Number.isFinite(partNumber)) continue
        parts.push({ partNumber, bytes: new Uint8Array(await readFile(path.join(directory, name))) })
      }
      return parts
    },
    async clear() {
      await rm(directory, { recursive: true, force: true })
    },
  }
}

/**
 * 清掉陈旧的暂存目录。
 *
 * 只删本应用自己建的、名字匹配这个前缀的目录——`os.tmpdir()` 里还有别的程序的東西，
 * 扫宽了会删到不属于我们的文件。
 */
export async function sweepStaleMeetingSpools(
  root: string = meetingSpoolRoot(),
  now: number = Date.now(),
): Promise<readonly string[]> {
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const entry of entries) {
    if (!entry.startsWith(SPOOL_PREFIX)) continue
    const directory = path.join(root, entry)
    try {
      const info = await stat(directory)
      if (!info.isDirectory() || now - info.mtimeMs < STALE_SPOOL_AGE_MS) continue
      await rm(directory, { recursive: true, force: true })
      removed.push(entry)
    } catch {
      // 目录刚好被别处收走，不是错误。
    }
  }
  return removed
}
