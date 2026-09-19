import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

describe("会议 IPC 通道", () => {
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
    })
    await expect(service.uploadPart("rec-2", 1, new Uint8Array([9, 9]))).rejects.toThrow("网络断了")
    const pending = await createMeetingSpool("rec-2", root).pending()
    expect(pending).toHaveLength(1)
    expect([...pending[0].bytes]).toEqual([9, 9])
  })

  it("完成之后本机暂存清空", async () => {
    const service = createMeetingService({ fetchAuthenticated, spoolRoot: root })
    await service.uploadPart("rec-3", 1, new Uint8Array([1]))
    await service.completeRecording("rec-3", { durationMs: 1000, peaks: "", speakerCount: 0 })
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

  /** 服务端说上一段没录完，本机还留着最后一片。 */
  function stubServer(calls: { path: string; body: unknown }[]) {
    return vi.fn(async (requestPath: string, init?: RequestInit) => {
      // 分片是裸字节，只有 JSON 请求才解析 body。
      const isJson = String(init?.headers && (init.headers as Record<string, string>)["content-type"]).includes("json")
      calls.push({ path: requestPath, body: isJson && init?.body ? JSON.parse(String(init.body)) : null })
      if (requestPath === "/meetings/recordings/pending") {
        return jsonResponse({
          meetingId: "m-1",
          recordingId: "r-1",
          title: "Q3 评审",
          receivedBytes: 8000,
          startedAt: "2026-09-19T02:00:00.000Z",
        })
      }
      return jsonResponse({})
    }) as unknown as MeetingAuthenticatedFetch
  }

  it("补上本机残留的那一片，再按正常录音收尾", async () => {
    const calls: { path: string; body: unknown }[] = []
    const service = createMeetingService({ fetchAuthenticated: stubServer(calls), spoolRoot: root })
    // 进程被杀时最后一片还躺在暂存里。
    await createMeetingSpool("r-1", root).stage(3, new Uint8Array([1, 2, 3]))

    await service.finalizePendingRecording()

    expect(calls.map((call) => call.path)).toEqual([
      "/meetings/recordings/pending",
      "/meetings/recordings/r-1/parts/3",
      "/meetings/recordings/r-1/complete",
    ])
    // 时长只能用已传字节数估：8000 字节 ÷ 8 KB/s = 1 秒。波形只在内存里，跟着进程
    // 一起没了，所以 peaks 只能交空。
    expect(calls[2].body).toEqual({ durationMs: 1000, peaks: "", speakerCount: 0 })
    // 收尾之后本机不留东西。
    expect(await createMeetingSpool("r-1", root).pending()).toEqual([])
  })

  it("没有待收尾的录音时什么都不做", async () => {
    const calls: { path: string; body: unknown }[] = []
    const service = createMeetingService({
      fetchAuthenticated: vi.fn(async (requestPath: string) => {
        calls.push({ path: requestPath, body: null })
        return jsonResponse(null)
      }) as unknown as MeetingAuthenticatedFetch,
      spoolRoot: root,
    })
    await service.finalizePendingRecording()
    expect(calls.map((call) => call.path)).toEqual(["/meetings/recordings/pending"])
  })

  it("收尾失败不让调用方看见错误，应用照常起来", async () => {
    const warnings: string[] = []
    const service = createMeetingService({
      fetchAuthenticated: (async () => {
        throw new Error("网络断了")
      }) as unknown as MeetingAuthenticatedFetch,
      spoolRoot: root,
      logger: { warn: (message) => warnings.push(message) },
    })
    await expect(service.finalizePendingRecording()).resolves.toBeUndefined()
    expect(warnings).toEqual(["Meeting pending recording finalize failed."])
  })

  it("同时叫两次也只收尾一次", async () => {
    const calls: { path: string; body: unknown }[] = []
    const service = createMeetingService({ fetchAuthenticated: stubServer(calls), spoolRoot: root })
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
    })
    await expect(service.startRecording({})).rejects.toThrow("不完整")
  })

  it("列表拿不到 items 时返回空数组，而不是 undefined 让界面炸掉", async () => {
    const service = createMeetingService({ fetchAuthenticated: async () => jsonResponse({}), spoolRoot: root })
    await expect(service.listMeetings()).resolves.toEqual([])
  })

  it("回放地址缺失时返回 null", async () => {
    const service = createMeetingService({ fetchAuthenticated: async () => jsonResponse({}), spoolRoot: root })
    await expect(service.getPlaybackUrl("m-1")).resolves.toEqual({ url: null })
  })

  it("会议 id 会被转义，不会被当成路径片段", async () => {
    const paths: string[] = []
    const service = createMeetingService({
      fetchAuthenticated: async (requestPath) => {
        paths.push(requestPath)
        return jsonResponse({})
      },
      spoolRoot: root,
    })
    await service.getMeeting("a/../b")
    expect(paths[0]).toBe("/meetings/a%2F..%2Fb")
  })
})
