import { mkdir, mkdtemp, readdir, rm, stat, utimes } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createMeetingSpool, meetingSpoolDirectory, STALE_SPOOL_AGE_MS, sweepStaleMeetingSpools } from "../spool"

const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-meeting-spool-test-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  roots.length = 0
})

describe("本机暂存", () => {
  it("落盘之后能原样读回来", async () => {
    const root = await temporaryRoot()
    const spool = createMeetingSpool("rec-1", root)
    await spool.stage(1, new Uint8Array([1, 2, 3]))
    const pending = await spool.pending()
    expect(pending).toHaveLength(1)
    expect(pending[0].partNumber).toBe(1)
    expect([...pending[0].bytes]).toEqual([1, 2, 3])
  })

  it("确认过的分片不再留在暂存里", async () => {
    const root = await temporaryRoot()
    const spool = createMeetingSpool("rec-2", root)
    await spool.stage(1, new Uint8Array([1]))
    await spool.stage(2, new Uint8Array([2]))
    await spool.confirm(1)
    const pending = await spool.pending()
    expect(pending.map((part) => part.partNumber)).toEqual([2])
  })

  it("按编号升序返回，续传时顺序不会乱", async () => {
    const root = await temporaryRoot()
    const spool = createMeetingSpool("rec-3", root)
    await spool.stage(10, new Uint8Array([10]))
    await spool.stage(2, new Uint8Array([2]))
    await spool.stage(1, new Uint8Array([1]))
    expect((await spool.pending()).map((part) => part.partNumber)).toEqual([1, 2, 10])
  })

  it("目录名由 recordingId 决定，重启之后还能找回同一段录音", async () => {
    const root = await temporaryRoot()
    const first = createMeetingSpool("rec-4", root)
    await first.stage(1, new Uint8Array([1, 2, 3]))
    // 换一个实例模拟进程重启：靠目录名而不是内存里的映射找回来。
    const second = createMeetingSpool("rec-4", root)
    expect(await second.pending()).toHaveLength(1)
    expect(second.directory).toBe(first.directory)
  })

  it("clear 把整段录音的暂存收干净", async () => {
    const root = await temporaryRoot()
    const spool = createMeetingSpool("rec-5", root)
    await spool.stage(1, new Uint8Array([1]))
    await spool.clear()
    expect(await spool.pending()).toEqual([])
  })

  it("recordingId 里带分隔符也拼不出第二层目录", async () => {
    const root = await temporaryRoot()
    const directory = meetingSpoolDirectory("../../etc/passwd", root)
    // 关键不变量：结果永远是 root 下的**单个**路径片段。分隔符被换掉，`..` 也不再是
    // 上级引用——它只是名字里的两个字符，而且前面还固定带着我们的前缀。
    expect(path.dirname(path.resolve(directory))).toBe(path.resolve(root))
    expect(path.relative(root, directory).includes(path.sep)).toBe(false)
  })

  it("前缀保证目录名不会是 . 或 ..", async () => {
    const root = await temporaryRoot()
    expect(path.basename(meetingSpoolDirectory("..", root))).toMatch(/^synapse-meeting-recording-/)
    expect(path.basename(meetingSpoolDirectory(".", root))).toMatch(/^synapse-meeting-recording-/)
  })

  it("没有暂存时返回空数组，不报错", async () => {
    const root = await temporaryRoot()
    expect(await createMeetingSpool("never-used", root).pending()).toEqual([])
  })
})

describe("陈旧暂存清理", () => {
  it("只删本应用建的目录，别人的文件一根不动", async () => {
    const root = await temporaryRoot()
    await mkdir(path.join(root, "some-other-app-directory"), { recursive: true })
    const spool = createMeetingSpool("rec-6", root)
    await spool.stage(1, new Uint8Array([1]))
    const info = await stat(spool.directory)
    const old = new Date(Date.now() - STALE_SPOOL_AGE_MS - 60_000)
    await utimes(spool.directory, old, old)
    void info

    const removed = await sweepStaleMeetingSpools(root)
    expect(removed).toHaveLength(1)
    await expect(stat(spool.directory)).rejects.toThrow()
    expect(await readdir(root)).toContain("some-other-app-directory")
  })

  it("刚建的暂存不会被扫掉", async () => {
    const root = await temporaryRoot()
    const spool = createMeetingSpool("rec-7", root)
    await spool.stage(1, new Uint8Array([1]))
    expect(await sweepStaleMeetingSpools(root)).toEqual([])
    expect(await spool.pending()).toHaveLength(1)
  })

  it("目录不存在时安静返回", async () => {
    expect(await sweepStaleMeetingSpools(path.join(os.tmpdir(), "synapse-does-not-exist-xyz"))).toEqual([])
  })
})
