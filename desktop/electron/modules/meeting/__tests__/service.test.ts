import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createMeetingAudioCache, meetingAudioUrlForId } from "../audio-cache"
import { createMeetingSpool } from "../spool"
import { createMeetingService, type MeetingAuthenticatedFetch } from "../service"
import { meetingIpcModule } from "../ipc"

const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-meeting-service-test-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  roots.length = 0
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

/**
 * 音频缓存那两件依赖。
 *
 * 这一组用例管的是分片、收尾和取消，不碰缓存；给一个落在同一个临时目录里的位置即可，
 * 免得每个用例都要为它多写两行。
 */
function audioDeps(root: string) {
  return {
    audioCacheRoot: path.join(root, "audio-cache"),
    fetchPublic: async () => jsonResponse({}),
  }
}

/** 本机是不是录了这一条。判据是暂存目录在不在，与产品代码同一套。 */
async function ownsSpoolDirectory(recordingId: string, root: string): Promise<boolean> {
  try {
    await stat(path.join(root, `synapse-meeting-recording-${recordingId}`))
    return true
  } catch {
    return false
  }
}

describe("录音 IPC 通道", () => {
  it("operation id 与派生的 channel 一致", () => {
    expect(meetingIpcModule.methods.startRecording.operationId).toBe("app.meeting.recording.start")
    expect(meetingIpcModule.methods.uploadPart.operationId).toBe("app.meeting.recording.part.upload")
    expect(meetingIpcModule.methods.completeRecording.operationId).toBe("app.meeting.recording.complete")
    expect(meetingIpcModule.methods.cancelRecording.operationId).toBe("app.meeting.recording.cancel")
    expect(meetingIpcModule.methods.list.operationId).toBe("app.meeting.entry.list")
    expect(meetingIpcModule.methods.get.operationId).toBe("app.meeting.entry.get")
    expect(meetingIpcModule.methods.deleteMeeting.operationId).toBe("app.meeting.entry.remove")
  })

  it("没有调用方的写入接口不再注册", () => {
    // 纪要和发言人两端的界面都不再渲染，留着就是永远没人调的通道。删掉的方法名会
    // 直接让这一行取不到值，红了说明有东西又长回来了。
    for (const name of ["nameSpeaker", "saveMinutes", "generateMinutes", "deleteRecording"]) {
      expect(meetingIpcModule.methods[name as keyof typeof meetingIpcModule.methods]).toBeUndefined()
    }
  })

  it("分片请求接受裸字节", () => {
    const parsed = meetingIpcModule.methods.uploadPart.request.safeParse({
      recordingId: "rec-1",
      partNumber: 1,
      bytes: new Uint8Array([1, 2, 3]),
    })
    expect(parsed.success).toBe(true)
  })

  it("分片编号从 1 开始，0 和越界都被拒", () => {
    const schema = meetingIpcModule.methods.uploadPart.request
    expect(schema.safeParse({ recordingId: "rec-1", partNumber: 0, bytes: new Uint8Array([1]) }).success).toBe(false)
    expect(schema.safeParse({ recordingId: "rec-1", partNumber: 20_000, bytes: new Uint8Array([1]) }).success).toBe(false)
  })
})

describe("分片的落盘顺序", () => {
  let root: string
  let fetchAuthenticated: MeetingAuthenticatedFetch

  beforeEach(async () => {
    root = await temporaryRoot()
    fetchAuthenticated = vi.fn(async () => jsonResponse({})) as unknown as MeetingAuthenticatedFetch
  })

  it("先落盘、再发请求、确认之后才删本地", async () => {
    const order: string[] = []
    const service = createMeetingService({
      fetchAuthenticated: async (path) => {
        order.push("send")
        // 请求进行中，字节必须已经在本机了——否则进程这个时候被杀就全没了。
        const spool = createMeetingSpool("rec-1", root)
        order.push((await spool.pending()).length > 0 ? "staged" : "missing")
        return jsonResponse({})
      },
      spoolRoot: root,
      ...audioDeps(root),
    })
    await service.uploadPart("rec-1", 1, new Uint8Array([1, 2, 3]))
    expect(order).toEqual(["send", "staged"])
    // 确认之后本机不再保留这一片。
    expect(await createMeetingSpool("rec-1", root).pending()).toEqual([])
  })

  it("发送失败时本机仍留着那一份字节，可以重传", async () => {
    const service = createMeetingService({
      fetchAuthenticated: async () => {
        throw new Error("网络断了")
      },
      spoolRoot: root,
      ...audioDeps(root),
    })
    await expect(service.uploadPart("rec-2", 1, new Uint8Array([9, 9]))).rejects.toThrow("网络断了")
    const pending = await createMeetingSpool("rec-2", root).pending()
    expect(pending).toHaveLength(1)
    expect([...pending[0].bytes]).toEqual([9, 9])
  })

  it("完成之后本机暂存清空", async () => {
    const service = createMeetingService({ fetchAuthenticated, spoolRoot: root, ...audioDeps(root) })
    await service.uploadPart("rec-3", 1, new Uint8Array([1]))
    await service.completeRecording("rec-3", { durationMs: 1000, peaks: "" })
    expect(await createMeetingSpool("rec-3", root).pending()).toEqual([])
  })

  it("取消既清本机暂存，也告诉服务端中止", async () => {
    const calls: string[] = []
    const service = createMeetingService({
      fetchAuthenticated: async (requestPath, init) => {
        calls.push(`${init?.method ?? "GET"} ${requestPath}`)
        return jsonResponse({})
      },
      spoolRoot: root,
      ...audioDeps(root),
    })
    await service.uploadPart("rec-4", 1, new Uint8Array([1]))
    await service.cancelRecording("rec-4")
    expect(calls).toContain("DELETE /meetings/recordings/rec-4")
    expect(await createMeetingSpool("rec-4", root).pending()).toEqual([])
  })

  it("取消先清本机：即使服务端请求失败，本机也不留下用不上的字节", async () => {
    const service = createMeetingService({
      fetchAuthenticated: async (requestPath, init) => {
        if (init?.method === "DELETE") throw new Error("服务端不可达")
        return jsonResponse({})
      },
      spoolRoot: root,
      ...audioDeps(root),
    })
    await service.uploadPart("rec-5", 1, new Uint8Array([1]))
    await expect(service.cancelRecording("rec-5")).rejects.toThrow("服务端不可达")
    expect(await createMeetingSpool("rec-5", root).pending()).toEqual([])
  })
})

describe("异常退出的静默收尾", () => {
  let root: string

  beforeEach(async () => {
    root = await temporaryRoot()
  })

  /** 服务端说上一段没录完。本机有没有残片由测试自己摆。 */
  function stubServer(calls: { path: string; body: unknown }[], pending: readonly unknown[] = [PENDING_R_1]) {
    return vi.fn(async (requestPath: string, init?: RequestInit) => {
      // 分片是裸字节，只有 JSON 请求才解析 body。
      const isJson = String(init?.headers && (init.headers as Record<string, string>)["content-type"]).includes("json")
      calls.push({ path: requestPath, body: isJson && init?.body ? JSON.parse(String(init.body)) : null })
      if (requestPath === "/meetings/recordings/pending?all=1") return jsonResponse({ items: pending })
      return jsonResponse({})
    }) as unknown as MeetingAuthenticatedFetch
  }

  const PENDING_R_1 = {
    meetingId: "m-1",
    recordingId: "r-1",
    title: "Q3 评审",
    receivedBytes: 8000,
    startedAt: "2026-09-19T02:00:00.000Z",
  }

  /** 服务端说没收尾、而且**本机确实录了**这一条。 */
  async function ownThisRecording(recordingId: string, root: string): Promise<void> {
    await createMeetingSpool(recordingId, root).stage(1, new Uint8Array([0]))
    await createMeetingSpool(recordingId, root).confirm(1)
  }

  it("补上本机残留的那一片，再按正常录音收尾", async () => {
    const calls: { path: string; body: unknown }[] = []
    const service = createMeetingService({ fetchAuthenticated: stubServer(calls), spoolRoot: root, ...audioDeps(root) })
    // 进程被杀时最后一片还躺在暂存里。
    await createMeetingSpool("r-1", root).stage(3, new Uint8Array([1, 2, 3]))

    await service.finalizePendingRecording()

    expect(calls.map((call) => call.path)).toEqual([
      "/meetings/recordings/pending?all=1",
      "/meetings/recordings/r-1/parts/3",
      "/meetings/recordings/r-1/complete",
    ])
    // 时长只能用已传字节数估：8000 字节 ÷ 8 KB/s = 1 秒。波形只在内存里，跟着进程
    // 一起没了，所以 peaks 只能交空。
    expect(calls[2].body).toEqual({ durationMs: 1000, peaks: "" })
    // 收尾之后本机不留东西。
    expect(await createMeetingSpool("r-1", root).pending()).toEqual([])
  })

  it("没有待收尾的录音时什么都不做", async () => {
    const calls: { path: string; body: unknown }[] = []
    const service = createMeetingService({
      fetchAuthenticated: vi.fn(async (requestPath: string) => {
        calls.push({ path: requestPath, body: null })
        return jsonResponse({ items: [] })
      }) as unknown as MeetingAuthenticatedFetch,
      spoolRoot: root,
      ...audioDeps(root),
    })
    await service.finalizePendingRecording()
    expect(calls.map((call) => call.path)).toEqual(["/meetings/recordings/pending?all=1"])
  })

  it("别的设备录的那条不碰", async () => {
    // 手机在录，用户在电脑上打开 Synapse。服务端会说「有一条没收尾」，但本机没有这条的
    // 暂存目录——残片只在本机，本机既没有字节也没有波形，抢过来收尾只会用一个估算的
    // 时长和一条平线把人家正在录的东西毁掉。
    const calls: { path: string; body: unknown }[] = []
    const service = createMeetingService({ fetchAuthenticated: stubServer(calls), spoolRoot: root, ...audioDeps(root) })

    await service.finalizePendingRecording()

    expect(calls.map((call) => call.path)).toEqual(["/meetings/recordings/pending?all=1"])
    expect(calls.some((call) => call.path.endsWith("/complete"))).toBe(false)
  })

  it("本机录的那条，即使暂存里一片都不剩也照样收尾", async () => {
    // 分片是服务端确认一片就删一片，所以进程被杀时暂存往往是空的。拿「有没有分片」当
    // 判据，会把本机自己录的那条判成别人的——那条从此永远停在「转写中」。
    const calls: { path: string; body: unknown }[] = []
    const service = createMeetingService({ fetchAuthenticated: stubServer(calls), spoolRoot: root, ...audioDeps(root) })
    await ownThisRecording("r-1", root)

    await service.finalizePendingRecording()

    expect(calls.map((call) => call.path)).toEqual([
      "/meetings/recordings/pending?all=1",
      "/meetings/recordings/r-1/complete",
    ])
  })

  it("开始录音就把本机凭据立起来，不必等第一个分片攒够", async () => {
    // 1 MB 分片约合 128 秒。不在一开始就把目录建起来，录到一半被杀的那些录音就再也认不
    // 出是本机录的。
    const service = createMeetingService({
      fetchAuthenticated: async () =>
        jsonResponse({ meetingId: "m-1", recordingId: "r-9", uploadId: "u-1", title: "新录音" }),
      spoolRoot: root,
      ...audioDeps(root),
    })
    await service.startRecording({})
    expect(await ownsSpoolDirectory("r-9", root)).toBe(true)
  })

  it("收尾失败不让调用方看见错误，应用照常起来", async () => {
    const warnings: string[] = []
    const service = createMeetingService({
      fetchAuthenticated: (async () => {
        throw new Error("网络断了")
      }) as unknown as MeetingAuthenticatedFetch,
      spoolRoot: root,
      ...audioDeps(root),
      logger: { warn: (message) => warnings.push(message) },
    })
    await expect(service.finalizePendingRecording()).resolves.toBeUndefined()
    expect(warnings).toEqual(["Meeting pending recording finalize failed."])
  })

  it("同时叫两次也只收尾一次", async () => {
    const calls: { path: string; body: unknown }[] = []
    const service = createMeetingService({ fetchAuthenticated: stubServer(calls), spoolRoot: root, ...audioDeps(root) })
    await ownThisRecording("r-1", root)
    await Promise.all([service.finalizePendingRecording(), service.finalizePendingRecording()])
    expect(calls.filter((call) => call.path === "/meetings/recordings/r-1/complete")).toHaveLength(1)
  })

  it("渲染进程没有任何询问未完成录音的入口", () => {
    // 「发现一段未完成的录音，丢弃还是完成？」那个弹窗的整条链路都拆了：收尾改在主进程
    // 后台做，界面彻底不知道这件事存在。下面这些方法名一旦重新出现，就说明询问又长回
    // 来了——这条断言就是「界面上不出现任何询问」这个要求本身。
    for (const name of ["findPendingRecording", "readSpooledParts"]) {
      expect(meetingIpcModule.methods[name as keyof typeof meetingIpcModule.methods]).toBeUndefined()
    }
  })
})

describe("接口调用", () => {
  let root: string

  beforeEach(async () => {
    root = await temporaryRoot()
  })

  it("开始录音把服务端返回的三样都带回来", async () => {
    const service = createMeetingService({
      fetchAuthenticated: async () =>
        jsonResponse({ meetingId: "m-1", recordingId: "r-1", uploadId: "u-1", title: "Q3 评审" }),
      spoolRoot: root,
      ...audioDeps(root),
    })
    await expect(service.startRecording({ title: "Q3 评审" })).resolves.toMatchObject({
      meetingId: "m-1",
      recordingId: "r-1",
      uploadId: "u-1",
      title: "Q3 评审",
    })
  })

  it("服务端返回残缺时不硬撑，直接报错", async () => {
    const service = createMeetingService({
      fetchAuthenticated: async () => jsonResponse({ meetingId: "m-1" }),
      spoolRoot: root,
      ...audioDeps(root),
    })
    await expect(service.startRecording({})).rejects.toThrow("不完整")
  })

  it("列表拿不到 items 时返回空数组，而不是 undefined 让界面炸掉", async () => {
    const service = createMeetingService({ fetchAuthenticated: async () => jsonResponse({}), spoolRoot: root, ...audioDeps(root) })
    await expect(service.listMeetings()).resolves.toEqual([])
  })

  it("回放地址缺失时返回 null", async () => {
    const service = createMeetingService({ fetchAuthenticated: async () => jsonResponse({}), spoolRoot: root, ...audioDeps(root) })
    await expect(service.getPlaybackUrl("m-1")).resolves.toEqual({ url: null })
  })

  it("录音 id 会被转义，不会被当成路径片段", async () => {
    const paths: string[] = []
    const service = createMeetingService({
      fetchAuthenticated: async (requestPath) => {
        paths.push(requestPath)
        return jsonResponse({})
      },
      spoolRoot: root,
      ...audioDeps(root),
    })
    await service.getMeeting("a/../b")
    expect(paths[0]).toBe("/meetings/a%2F..%2Fb")
  })
})

describe("音频缓存跟着服务端走", () => {
  let root: string

  beforeEach(async () => {
    root = await temporaryRoot()
  })

  /** 本机缓存里造一条，模拟「这条听过」。 */
  async function seedCached(meetingId: string): Promise<ReturnType<typeof createMeetingAudioCache>> {
    const cacheRoot = path.join(root, "audio-cache")
    await mkdir(cacheRoot, { recursive: true })
    const cache = createMeetingAudioCache({ root: cacheRoot })
    await writeFile(cache.audioPath(meetingId), Buffer.alloc(16, 1))
    await cache.save({ meetingId, size: 16, peaks: "", lastPlayedAt: "2026-01-01T00:00:00.000Z" })
    return cache
  }

  function listResponse(count: number, firstId: string): Response {
    return jsonResponse({ items: Array.from({ length: count }, (_, index) => ({ id: `${firstId}-${index}` })) })
  }

  it("列表条数少于上限时，本机有、列表里没有的那条被清掉", async () => {
    const cache = await seedCached("m-gone")
    const service = createMeetingService({
      fetchAuthenticated: async () => listResponse(199, "m-kept"),
      spoolRoot: root,
      ...audioDeps(root),
    })
    await service.listMeetings()
    expect(await cache.lookup("m-gone", 16)).toBeNull()
  })

  it("列表条数刚好等于上限时，一条都不清", async () => {
    // 200 是服务端一次给的上限；等于上限说明还有更早的没返回，那些不在列表里的只是没
    // 返回、不是被删了。这一条判错就会把用户的缓存整片误删。
    const cache = await seedCached("m-gone")
    const service = createMeetingService({
      fetchAuthenticated: async () => listResponse(200, "m-kept"),
      spoolRoot: root,
      ...audioDeps(root),
    })
    await service.listMeetings()
    expect(await cache.lookup("m-gone", 16)).not.toBeNull()
  })

  it("列表里还有的那条不会被清", async () => {
    const cache = await seedCached("m-kept")
    const service = createMeetingService({
      fetchAuthenticated: async () => jsonResponse({ items: [{ id: "m-kept" }] }),
      spoolRoot: root,
      ...audioDeps(root),
    })
    await service.listMeetings()
    expect(await cache.lookup("m-kept", 16)).not.toBeNull()
  })

  it("在本机删掉一条：缓存文件同时没", async () => {
    const cache = await seedCached("m-1")
    const service = createMeetingService({
      fetchAuthenticated: async () => jsonResponse({}),
      spoolRoot: root,
      ...audioDeps(root),
    })
    await service.deleteMeeting("m-1")
    expect(await cache.lookup("m-1", 16)).toBeNull()
    await expect(stat(cache.audioPath("m-1"))).rejects.toThrow()
  })

  it("删失败时不连累本机缓存——服务端还留着这条，本机那份也还该能用", async () => {
    const cache = await seedCached("m-1")
    const service = createMeetingService({
      fetchAuthenticated: async () => {
        throw new Error("服务端不可达")
      },
      spoolRoot: root,
      ...audioDeps(root),
    })
    await expect(service.deleteMeeting("m-1")).rejects.toThrow("服务端不可达")
    expect(await cache.lookup("m-1", 16)).not.toBeNull()
  })

  it("波形在缓存里就直接给，不再打服务端", async () => {
    const paths: string[] = []
    const cacheRoot = path.join(root, "audio-cache")
    await mkdir(cacheRoot, { recursive: true })
    const cache = createMeetingAudioCache({ root: cacheRoot })
    await writeFile(cache.audioPath("m-1"), Buffer.alloc(16, 1))
    await cache.save({ meetingId: "m-1", size: 16, peaks: "peaks-cached", lastPlayedAt: "2026-01-01T00:00:00.000Z" })
    const service = createMeetingService({
      fetchAuthenticated: async (requestPath) => {
        paths.push(requestPath)
        return jsonResponse({ peaks: "peaks-from-server" })
      },
      spoolRoot: root,
      ...audioDeps(root),
    })
    await expect(service.getPeaks("m-1")).resolves.toEqual({ peaks: "peaks-cached" })
    expect(paths).toEqual([])
  })

  it("缓存里没有波形时照旧去服务端取", async () => {
    const service = createMeetingService({
      fetchAuthenticated: async () => jsonResponse({ peaks: "peaks-from-server" }),
      spoolRoot: root,
      ...audioDeps(root),
    })
    await expect(service.getPeaks("m-1")).resolves.toEqual({ peaks: "peaks-from-server" })
  })
})

describe("ensure 音频", () => {
  let root: string

  beforeEach(async () => {
    root = await temporaryRoot()
  })

  const AUDIO_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])

  /** 只回应 ensure 会用到的三个接口。 */
  function audioServer(calls: string[], detail: unknown = { id: "m-1", recording: { status: "ready", size: 8 } }) {
    return (async (requestPath: string) => {
      calls.push(requestPath)
      if (requestPath === "/meetings/m-1") return jsonResponse(detail)
      if (requestPath === "/meetings/m-1/audio-url") return jsonResponse({ url: "https://storage.example/signed" })
      if (requestPath === "/meetings/m-1/peaks") return jsonResponse({ peaks: "peaks-data" })
      return jsonResponse({})
    }) as unknown as MeetingAuthenticatedFetch
  }

  function buildService(overrides: Partial<Parameters<typeof createMeetingService>[0]> = {}) {
    return createMeetingService({
      fetchAuthenticated: audioServer([]),
      spoolRoot: root,
      ...audioDeps(root),
      fetchPublic: async () => new Response(AUDIO_BYTES, { status: 200 }),
      ...overrides,
    })
  }

  /** 把下载挂在半路，好观察「还没下完」的那段时间。 */
  function gateOnDownload() {
    const gate: { release?: () => void } = {}
    return {
      gate,
      fetchPublic: async () =>
        new Promise<Response>((resolve) => {
          gate.release = () => resolve(new Response(AUDIO_BYTES, { status: 200 }))
        }),
    }
  }

  it("第一次是下载中，下完推一条事件，再问就是就绪", async () => {
    const events: { type: string; payload: unknown }[] = []
    const { gate, fetchPublic } = gateOnDownload()
    const service = buildService({
      fetchPublic,
      eventBus: { emit: (event) => events.push({ type: event.type, payload: event.payload }) },
    })

    await expect(service.ensureAudio("m-1")).resolves.toEqual({ state: "downloading" })
    await vi.waitFor(() => expect(gate.release).toBeDefined())
    gate.release?.()
    await vi.waitFor(async () => {
      await expect(service.ensureAudio("m-1")).resolves.toEqual({
        state: "ready",
        url: meetingAudioUrlForId("m-1"),
      })
    })
    expect(events.map((event) => event.type)).toEqual(["meeting.audioReady"])
    expect(events[0].payload).toMatchObject({ meetingId: "m-1", url: meetingAudioUrlForId("m-1") })
  })

  it("同一个 meetingId 反复叫不会起第二个下载", async () => {
    let downloads = 0
    const { gate } = gateOnDownload()
    const service = buildService({
      fetchPublic: async () => {
        downloads += 1
        return new Promise<Response>((resolve) => {
          gate.release = () => resolve(new Response(AUDIO_BYTES, { status: 200 }))
        })
      },
    })

    await expect(service.ensureAudio("m-1")).resolves.toEqual({ state: "downloading" })
    await vi.waitFor(() => expect(downloads).toBe(1))
    // 下载正卡在半路时再叫两次：都该原样返回，不能各起一个。
    await expect(service.ensureAudio("m-1")).resolves.toEqual({ state: "downloading" })
    await expect(service.ensureAudio("m-1")).resolves.toEqual({ state: "downloading" })
    expect(downloads).toBe(1)

    gate.release?.()
    await vi.waitFor(async () => {
      await expect(service.ensureAudio("m-1")).resolves.toMatchObject({ state: "ready" })
    })
    // 下完之后再叫也不该重新下——这次是缓存命中的那条路。
    expect(downloads).toBe(1)
  })

  it("命中缓存时直接给本机地址，一个字节都不下", async () => {
    let downloads = 0
    const service = buildService({ fetchPublic: async () => { downloads += 1; return new Response(AUDIO_BYTES) } })
    await service.ensureAudio("m-1")
    await vi.waitFor(async () => {
      await expect(service.ensureAudio("m-1")).resolves.toEqual({ state: "ready", url: meetingAudioUrlForId("m-1") })
    })
    const before = downloads
    await service.ensureAudio("m-1")
    expect(downloads).toBe(before)
  })

  it("服务端说这条录音没了：不给下载，也不假装在下载", async () => {
    const calls: string[] = []
    const service = buildService({
      fetchAuthenticated: audioServer(calls, { id: "m-1", recording: { status: "deleted", size: 0 } }),
    })
    await expect(service.ensureAudio("m-1")).resolves.toEqual({ state: "unavailable" })
    expect(calls).not.toContain("/meetings/m-1/audio-url")
  })

  it("签名地址被拒（403）时不会把错误正文当成音频存下来", async () => {
    // 对象存储拒绝时的正文是一小段 XML，不是音频。不看状态码就会把它写进缓存——
    // 一个「有文件、大小也对不上」的坏缓存会一直被当成未命中反复重下。
    const cacheRoot = path.join(root, "audio-cache")
    // 服务端连大小都给不出来（详情那一步没取到）。这时没有尺寸可以对照，唯一的关口
    // 就是 HTTP 状态码——少了它，这段 XML 会被当成一份 40 字节的「音频」存下来。
    const service = buildService({
      fetchAuthenticated: audioServer([], { id: "m-1", recording: { status: "ready", size: 0 } }),
      fetchPublic: async () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }),
    })
    await expect(service.ensureAudio("m-1")).resolves.toEqual({ state: "downloading" })
    await new Promise((resolve) => setTimeout(resolve, 50))
    await expect(stat(path.join(cacheRoot, "m-1.m4a"))).rejects.toThrow()
    const index = await readFile(path.join(cacheRoot, "index.json"), "utf8").catch(() => "")
    expect(index).not.toContain("AccessDenied")
  })

  it("下到的字节数与服务端记的对不上：不当成缓存，退避后再来", async () => {
    const service = buildService({
      fetchPublic: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
      fetchAuthenticated: audioServer([], { id: "m-1", recording: { status: "ready", size: 8 } }),
    })
    await expect(service.ensureAudio("m-1")).resolves.toEqual({ state: "downloading" })
    // 第一轮失败，退避 1 秒后第二轮。等一会儿之后仍然不该变成 ready。
    await new Promise((resolve) => setTimeout(resolve, 50))
    await expect(service.ensureAudio("m-1")).resolves.toEqual({ state: "downloading" })
  })
})
