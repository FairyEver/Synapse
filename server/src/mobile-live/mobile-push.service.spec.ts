import { generateKeyPairSync } from "node:crypto"
import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MobilePushService } from "./mobile-push.service"

const envMock = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock("../config/env", () => ({ loadEnv: () => envMock.current }))

const connectMock = vi.hoisted(() => vi.fn())
vi.mock("node:http2", () => ({ connect: connectMock }))

// APNs 私钥只需要能被 createSign 接受，测试里现场生成一把 P-256。
const keyMock = vi.hoisted(() => ({ pem: "" }))
vi.mock("node:fs/promises", () => ({ readFile: vi.fn(async () => keyMock.pem) }))

const PRODUCTION_HOST = "https://api.push.apple.com"
const SANDBOX_HOST = "https://api.sandbox.push.apple.com"

/** 让 http2 客户端在 request.end() 之后回一个可控的响应。 */
function stubApns(response: { status: number; body?: string }) {
  const request = new EventEmitter() as EventEmitter & Record<string, unknown>
  request.setEncoding = vi.fn()
  request.end = vi.fn(() => {
    queueMicrotask(() => {
      request.emit("response", { ":status": String(response.status) })
      if (response.body) request.emit("data", response.body)
      request.emit("end")
    })
  })
  const client = new EventEmitter() as EventEmitter & Record<string, unknown>
  client.request = vi.fn(() => request)
  client.close = vi.fn()
  connectMock.mockReturnValue(client)
  return { client, request }
}

function makeService(targets: Array<{ token: string }> = [{ token: "device-token-one" }]) {
  const devices = {
    listPushTargets: vi.fn(async () => targets.map((target) => ({ clientInstanceId: "instance-1", ...target }))),
    dropPushToken: vi.fn(async () => undefined),
    recordPushAttempt: vi.fn(async () => undefined),
  }
  return { service: new MobilePushService(devices as never), devices }
}

const push = { title: "标题", body: "正文", level: "active" as const, group: null, id: "n1" }

beforeEach(() => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
  keyMock.pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  envMock.current = {
    apnsKeyId: "KEYID12345",
    apnsTeamId: "TEAM123456",
    apnsKeyPath: "/run/secrets/apns.p8",
    apnsBundleId: "com.liy.SynapseMobile",
    apnsUseSandbox: false,
  }
})

afterEach(() => {
  connectMock.mockReset()
})

describe("MobilePushService", () => {
  it("skips entirely when APNs credentials are not configured", async () => {
    envMock.current = {}
    const { service, devices } = makeService()

    const outcome = await service.sendNotification("user-1", push)

    expect(outcome).toEqual({ sent: 0, failed: 0, skipped: true })
    expect(devices.listPushTargets).not.toHaveBeenCalled()
    expect(connectMock).not.toHaveBeenCalled()
  })

  it("always talks to the production gateway", async () => {
    stubApns({ status: 200 })
    const { service } = makeService()

    await service.sendNotification("user-1", push)

    // 数据线装的开发包拿到的是 sandbox token，如果这里改成 sandbox 网关，
    // 所有 TestFlight 用户的推送都会失效（苹果回 BadDeviceToken，服务端会把
    // 那些 token 当死号永久删掉）。这条断言锁的是「网关固定走生产」。
    expect(connectMock).toHaveBeenCalledWith(PRODUCTION_HOST)
    expect(connectMock).not.toHaveBeenCalledWith(SANDBOX_HOST)
  })

  it("reports a successful delivery without touching the token", async () => {
    stubApns({ status: 200 })
    const { service, devices } = makeService()

    const outcome = await service.sendNotification("user-1", push)

    expect(outcome).toEqual({ sent: 1, failed: 0, skipped: false })
    expect(devices.dropPushToken).not.toHaveBeenCalled()
  })

  it.each([
    { label: "410 status", response: { status: 410 } },
    { label: "BadDeviceToken reason", response: { status: 400, body: JSON.stringify({ reason: "BadDeviceToken" }) } },
    { label: "Unregistered reason", response: { status: 400, body: JSON.stringify({ reason: "Unregistered" }) } },
  ])("unregisters the token on $label instead of retrying it", async ({ response }) => {
    stubApns(response)
    const { service, devices } = makeService([{ token: "dead-token" }])

    const outcome = await service.sendNotification("user-1", push)

    // 被苹果拒掉的 token 重装后才会换新，所以它永远不会再生效——删掉而不是重试。
    expect(devices.dropPushToken).toHaveBeenCalledWith("dead-token")
    expect(outcome).toEqual({ sent: 0, failed: 1, skipped: false })
  })

  it("keeps the token when the failure is transient", async () => {
    stubApns({ status: 503, body: JSON.stringify({ reason: "ServiceUnavailable" }) })
    const { service, devices } = makeService([{ token: "busy-token" }])

    const outcome = await service.sendNotification("user-1", push)

    expect(devices.dropPushToken).not.toHaveBeenCalled()
    expect(outcome).toEqual({ sent: 0, failed: 1, skipped: false })
  })

  it("keeps the token when the transport itself fails", async () => {
    const client = new EventEmitter() as EventEmitter & Record<string, unknown>
    const request = new EventEmitter() as EventEmitter & Record<string, unknown>
    request.setEncoding = vi.fn()
    request.end = vi.fn(() => queueMicrotask(() => request.emit("error", new Error("socket hang up"))))
    client.request = vi.fn(() => request)
    client.close = vi.fn()
    connectMock.mockReturnValue(client)

    const { service, devices } = makeService([{ token: "flaky-token" }])

    const outcome = await service.sendNotification("user-1", push)

    expect(devices.dropPushToken).not.toHaveBeenCalled()
    expect(outcome).toEqual({ sent: 0, failed: 1, skipped: false })
  })
})
