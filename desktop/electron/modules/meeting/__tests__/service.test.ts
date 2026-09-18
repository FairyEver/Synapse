import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createMeetingSpool } from "../spool"
import { createMeetingService } from "../service"
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
    expect(meetingIpcModule.methods.deleteRecording.operationId).toBe("app.meeting.recording.delete")
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
  let fetchAuthenticated: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    root = await temporaryRoot()
    fetchAuthenticated = vi.fn(async () => jsonResponse({}))
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
