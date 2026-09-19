import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createMeetingAudioCache, parseByteRange, resolveMeetingAudioUrlId, meetingAudioUrlForId } from "../audio-cache"

/**
 * 缓存这一层的用例。
 *
 * 从「下次进来还要不要重新下载」这条线往回验：命中判据、淘汰顺序、以及**缓存坏了要当
 * 没缓存**。最后一条最容易漏——索引损坏、文件被手工改坏都不该让播放挂掉。
 */

const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-meeting-audio-cache-test-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  roots.length = 0
})

/** 落一个「音频文件 + 索引条目」，模拟一次下载完成的落盘结果。 */
async function seed(
  cache: ReturnType<typeof createMeetingAudioCache>,
  input: { readonly meetingId: string; readonly bytes: number; readonly lastPlayedAt: string; readonly peaks?: string },
): Promise<void> {
  await writeFile(cache.audioPath(input.meetingId), Buffer.alloc(input.bytes, 1))
  await cache.save({
    meetingId: input.meetingId,
    size: input.bytes,
    peaks: input.peaks ?? "peaks-data",
    lastPlayedAt: input.lastPlayedAt,
  })
}

describe("录音音频缓存", () => {
  let root: string

  beforeEach(async () => {
    root = await temporaryRoot()
  })

  describe("命中判据", () => {
    it("文件在、大小与服务端一致：命中", async () => {
      const cache = createMeetingAudioCache({ root })
      await seed(cache, { meetingId: "m-1", bytes: 32, lastPlayedAt: "2026-01-01T00:00:00.000Z" })
      const hit = await cache.lookup("m-1", 32)
      expect(hit?.path).toBe(cache.audioPath("m-1"))
      expect(hit?.peaks).toBe("peaks-data")
    })

    it("文件不存在：未命中", async () => {
      const cache = createMeetingAudioCache({ root })
      await seed(cache, { meetingId: "m-1", bytes: 32, lastPlayedAt: "2026-01-01T00:00:00.000Z" })
      await rm(cache.audioPath("m-1"))
      expect(await cache.lookup("m-1", 32)).toBeNull()
    })

    it("磁盘上的大小与索引记的不一致（文件被截断）：未命中", async () => {
      const cache = createMeetingAudioCache({ root })
      await seed(cache, { meetingId: "m-1", bytes: 32, lastPlayedAt: "2026-01-01T00:00:00.000Z" })
      await writeFile(cache.audioPath("m-1"), Buffer.alloc(16, 1))
      expect(await cache.lookup("m-1", 32)).toBeNull()
    })

    it("服务端说的 size 与索引记的不一致：未命中", async () => {
      const cache = createMeetingAudioCache({ root })
      await seed(cache, { meetingId: "m-1", bytes: 32, lastPlayedAt: "2026-01-01T00:00:00.000Z" })
      expect(await cache.lookup("m-1", 64)).toBeNull()
    })

    it("拿不到服务端大小（离线）时只按本机判：仍然命中", async () => {
      // 断网是听过的录音最该还能播的场景。判据里的服务端那一半这时候拿不到，退化成
      // 「文件在、大小对得上」就够了。
      const cache = createMeetingAudioCache({ root })
      await seed(cache, { meetingId: "m-1", bytes: 32, lastPlayedAt: "2026-01-01T00:00:00.000Z" })
      expect(await cache.lookup("m-1", 0)).not.toBeNull()
    })

    it("没有条目的一条：未命中", async () => {
      const cache = createMeetingAudioCache({ root })
      expect(await cache.lookup("m-unknown", 0)).toBeNull()
    })
  })

  describe("索引损坏", () => {
    it("索引不是合法 JSON：当作空缓存，不抛", async () => {
      const cache = createMeetingAudioCache({ root })
      await seed(cache, { meetingId: "m-1", bytes: 32, lastPlayedAt: "2026-01-01T00:00:00.000Z" })
      await writeFile(path.join(root, "index.json"), "{ not json")
      await expect(cache.lookup("m-1", 32)).resolves.toBeNull()
      // 之后还能正常写回去，缓存继续可用
      await seed(cache, { meetingId: "m-2", bytes: 8, lastPlayedAt: "2026-01-02T00:00:00.000Z" })
      expect(await cache.lookup("m-2", 8)).not.toBeNull()
    })

    it("索引版本对不上：当作空缓存", async () => {
      const cache = createMeetingAudioCache({ root })
      await writeFile(path.join(root, "index.json"), JSON.stringify({ version: 99, entries: [{ meetingId: "m-1", size: 32, lastPlayedAt: "x", peaks: "" }] }))
      expect(await cache.lookup("m-1", 32)).toBeNull()
    })

    it("索引里混着形状不对的条目：丢掉那几条，其余照用", async () => {
      const cache = createMeetingAudioCache({ root })
      await seed(cache, { meetingId: "m-good", bytes: 32, lastPlayedAt: "2026-01-01T00:00:00.000Z" })
      const raw = JSON.parse(await readFile(path.join(root, "index.json"), "utf8")) as { entries: unknown[] }
      raw.entries.push({ meetingId: "m-bad", size: "not-a-number" })
      raw.entries.push({ meetingId: "../escape", size: 1, lastPlayedAt: "x", peaks: "" })
      await writeFile(path.join(root, "index.json"), JSON.stringify(raw))
      expect(await cache.lookup("m-good", 32)).not.toBeNull()
      expect(await cache.lookup("m-bad", 0)).toBeNull()
    })

    it("写索引是原子的：临时文件不留在目录里", async () => {
      const cache = createMeetingAudioCache({ root })
      await seed(cache, { meetingId: "m-1", bytes: 32, lastPlayedAt: "2026-01-01T00:00:00.000Z" })
      const { readdir } = await import("node:fs/promises")
      const names = await readdir(root)
      expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([])
      expect(names.sort()).toEqual(["index.json", "m-1.m4a"])
    })
  })

  describe("超上限按最久没听的清", () => {
    it("超了就从最早播的那条开始删，直到降回上限", async () => {
      const cache = createMeetingAudioCache({ root, limitBytes: 100 })
      await seed(cache, { meetingId: "oldest", bytes: 40, lastPlayedAt: "2026-01-01T00:00:00.000Z" })
      await seed(cache, { meetingId: "middle", bytes: 40, lastPlayedAt: "2026-02-01T00:00:00.000Z" })
      await seed(cache, { meetingId: "newest", bytes: 40, lastPlayedAt: "2026-03-01T00:00:00.000Z" })

      const evicted = await cache.enforceLimit()
      expect(evicted).toEqual(["oldest"])
      expect(await cache.lookup("oldest", 40)).toBeNull()
      expect(await cache.lookup("middle", 40)).not.toBeNull()
      expect(await cache.lookup("newest", 40)).not.toBeNull()
      // 文件要跟着删掉，不能只从索引里摘掉——那才会真的占着地方。
      await expect(stat(cache.audioPath("oldest"))).rejects.toThrow()
    })

    it("一次删到降回上限为止", async () => {
      const cache = createMeetingAudioCache({ root, limitBytes: 50 })
      await seed(cache, { meetingId: "a", bytes: 40, lastPlayedAt: "2026-01-01T00:00:00.000Z" })
      await seed(cache, { meetingId: "b", bytes: 40, lastPlayedAt: "2026-02-01T00:00:00.000Z" })
      await seed(cache, { meetingId: "c", bytes: 40, lastPlayedAt: "2026-03-01T00:00:00.000Z" })
      expect(await cache.enforceLimit()).toEqual(["a", "b"])
    })

    it("没超上限时不动任何东西", async () => {
      const cache = createMeetingAudioCache({ root, limitBytes: 1000 })
      await seed(cache, { meetingId: "a", bytes: 40, lastPlayedAt: "2026-01-01T00:00:00.000Z" })
      await seed(cache, { meetingId: "b", bytes: 40, lastPlayedAt: "2026-02-01T00:00:00.000Z" })
      expect(await cache.enforceLimit()).toEqual([])
      expect(await cache.lookup("a", 40)).not.toBeNull()
    })

    it("播放会把这条挪到队尾，于是被淘汰的是别人", async () => {
      const cache = createMeetingAudioCache({ root, limitBytes: 100 })
      await seed(cache, { meetingId: "oldest", bytes: 40, lastPlayedAt: "2026-01-01T00:00:00.000Z" })
      await seed(cache, { meetingId: "middle", bytes: 40, lastPlayedAt: "2026-02-01T00:00:00.000Z" })
      await seed(cache, { meetingId: "newest", bytes: 40, lastPlayedAt: "2026-03-01T00:00:00.000Z" })

      await cache.touch("oldest", "2026-04-01T00:00:00.000Z")
      expect(await cache.enforceLimit()).toEqual(["middle"])
      expect(await cache.lookup("oldest", 40)).not.toBeNull()
    })
  })

  describe("列表刷新时只清真的被删了的", () => {
    it("返回条数少于上限：不在列表里的一条被清掉", async () => {
      const cache = createMeetingAudioCache({ root })
      await seed(cache, { meetingId: "kept", bytes: 32, lastPlayedAt: "2026-01-01T00:00:00.000Z" })
      await seed(cache, { meetingId: "gone", bytes: 32, lastPlayedAt: "2026-01-02T00:00:00.000Z" })

      await cache.pruneMissing(["kept"], true)
      expect(await cache.lookup("kept", 32)).not.toBeNull()
      expect(await cache.lookup("gone", 32)).toBeNull()
      await expect(stat(cache.audioPath("gone"))).rejects.toThrow()
    })

    it("返回条数刚好等于上限：一条都不清", async () => {
      // 等于上限说明还有更早的没返回，那些「不在列表里」的其实只是没返回。照规则清就是误删。
      const cache = createMeetingAudioCache({ root })
      await seed(cache, { meetingId: "kept", bytes: 32, lastPlayedAt: "2026-01-01T00:00:00.000Z" })
      await seed(cache, { meetingId: "older-than-the-page", bytes: 32, lastPlayedAt: "2026-01-02T00:00:00.000Z" })

      await cache.pruneMissing(["kept"], false)
      expect(await cache.lookup("older-than-the-page", 32)).not.toBeNull()
    })

    it("列表里有本机没有的：什么都不做", async () => {
      const cache = createMeetingAudioCache({ root })
      await seed(cache, { meetingId: "kept", bytes: 32, lastPlayedAt: "2026-01-01T00:00:00.000Z" })
      await expect(cache.pruneMissing(["kept", "never-cached"], true)).resolves.toBeUndefined()
      expect(await cache.lookup("kept", 32)).not.toBeNull()
    })
  })

  describe("删除与波形", () => {
    it("删掉一条：文件与索引条目一起没", async () => {
      const cache = createMeetingAudioCache({ root })
      await seed(cache, { meetingId: "m-1", bytes: 32, lastPlayedAt: "2026-01-01T00:00:00.000Z" })
      await cache.remove("m-1")
      await expect(stat(cache.audioPath("m-1"))).rejects.toThrow()
      expect(await cache.lookup("m-1", 32)).toBeNull()
      expect(await cache.peaksFor("m-1")).toBeNull()
    })

    it("删一条本来就没缓存的：不抛", async () => {
      const cache = createMeetingAudioCache({ root })
      await expect(cache.remove("m-unknown")).resolves.toBeUndefined()
    })

    it("波形跟着音频一起存，离线时取得到", async () => {
      const cache = createMeetingAudioCache({ root })
      await seed(cache, { meetingId: "m-1", bytes: 32, lastPlayedAt: "2026-01-01T00:00:00.000Z", peaks: "AAAA" })
      expect(await cache.peaksFor("m-1")).toBe("AAAA")
    })

    it("波形是空的就不算数，让调用方去服务端补", async () => {
      const cache = createMeetingAudioCache({ root })
      await seed(cache, { meetingId: "m-1", bytes: 32, lastPlayedAt: "2026-01-01T00:00:00.000Z", peaks: "" })
      expect(await cache.peaksFor("m-1")).toBeNull()
    })
  })
})

describe("Range 解析", () => {
  it("没有头就是没有区间", () => {
    expect(parseByteRange(null, 100)).toBeNull()
    expect(parseByteRange("", 100)).toBeNull()
    expect(parseByteRange("bytes=abc", 100)).toBeNull()
  })

  it("开头区间（播放器第一个请求就是它）", () => {
    expect(parseByteRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 })
    expect(parseByteRange("bytes=10-20", 100)).toEqual({ start: 10, end: 20 })
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 })
  })

  it("末尾超出的部分收到文件尾", () => {
    expect(parseByteRange("bytes=50-999", 100)).toEqual({ start: 50, end: 99 })
  })

  it("后缀区间取最后 N 个字节", () => {
    expect(parseByteRange("bytes=-20", 100)).toEqual({ start: 80, end: 99 })
    expect(parseByteRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 })
  })

  it("起点超出文件大小是越界，不是「没有区间」", () => {
    // 回 200 整份会让播放器以为区间被满足了，位置就对不上了。
    expect(parseByteRange("bytes=100-", 100)).toBe("unsatisfiable")
    expect(parseByteRange("bytes=200-300", 100)).toBe("unsatisfiable")
  })
})

describe("本机音频地址", () => {
  it("拼出来的地址能原样解析回去", () => {
    expect(resolveMeetingAudioUrlId(meetingAudioUrlForId("cm1abc-2"))).toBe("cm1abc-2")
  })

  it("别的协议、别的主机、多一层路径都拒掉", () => {
    expect(resolveMeetingAudioUrlId("file:///etc/passwd")).toBeNull()
    expect(resolveMeetingAudioUrlId("synapse-meeting-audio://elsewhere/m-1")).toBeNull()
    expect(resolveMeetingAudioUrlId("synapse-meeting-audio://local/a/b")).toBeNull()
    expect(resolveMeetingAudioUrlId("synapse-meeting-audio://local/..%2Fescape")).toBeNull()
    expect(resolveMeetingAudioUrlId("not a url")).toBeNull()
  })
})
