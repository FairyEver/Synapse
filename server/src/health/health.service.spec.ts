import { afterEach, describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { HealthService } from "./health.service"

// loadEnv 每次调用都重新解析传入的 source，所以这里用一个可变对象替身即可，
// 不必去构造一份完整的合法环境变量。
const envMock = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock("../config/env", () => ({ loadEnv: () => envMock.current }))

function makeService(options: { dbHealthy?: boolean } = {}) {
  const prisma = { isHealthy: vi.fn(async () => options.dbHealthy ?? true) } as unknown as PrismaService
  return new HealthService(prisma)
}

function stubFetch(handler: (url: string) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn((input: string | URL) => handler(String(input))))
}

afterEach(() => {
  envMock.current = {}
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("HealthService.readiness", () => {
  it("reports ok when every dependency is reachable", async () => {
    envMock.current = { pdfRendererUrl: "http://pdf-renderer:3010", driveCosBucket: "b", driveCosRegion: "r" }
    stubFetch(async () => new Response("{}", { status: 200 }))

    const result = await makeService().readiness()

    expect(result.status).toBe("ok")
    expect(result.checks.map((check) => check.name)).toEqual(["database", "pdfRenderer", "objectStorage"])
    expect(result.checks.every((check) => check.ok)).toBe(true)
  })

  it("reports degraded when the database is unreachable", async () => {
    stubFetch(async () => new Response("{}", { status: 200 }))

    const result = await makeService({ dbHealthy: false }).readiness()

    expect(result.status).toBe("degraded")
    expect(result.checks.find((check) => check.name === "database")).toMatchObject({ ok: false, detail: "query failed" })
  })

  it("treats an unconfigured pdf renderer as ok and does not probe it", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await makeService().readiness()

    expect(result.checks.find((check) => check.name === "pdfRenderer")).toMatchObject({ ok: true, detail: "not configured" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("reports degraded when the pdf renderer fails to answer", async () => {
    envMock.current = { pdfRendererUrl: "http://pdf-renderer:3010" }
    stubFetch(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:3010")
    })

    const result = await makeService().readiness()

    expect(result.status).toBe("degraded")
    expect(result.checks.find((check) => check.name === "pdfRenderer")).toMatchObject({ ok: false, detail: "unreachable" })
  })

  it("distinguishes a timeout from an unreachable dependency", async () => {
    envMock.current = { pdfRendererUrl: "http://pdf-renderer:3010" }
    stubFetch(async () => {
      const error = new Error("The operation was aborted due to timeout")
      error.name = "TimeoutError"
      throw error
    })

    const result = await makeService().readiness()

    expect(result.checks.find((check) => check.name === "pdfRenderer")).toMatchObject({ ok: false, detail: "timeout" })
  })

  it("counts a rejected but answering object storage endpoint as reachable", async () => {
    envMock.current = { driveCosBucket: "synapse-test", driveCosRegion: "ap-guangzhou" }
    stubFetch(async () => new Response("AccessDenied", { status: 403 }))

    const result = await makeService().readiness()

    // 未签名的请求被拒是预期的：拿到任何 HTTP 响应就说明网络与服务是活的。
    expect(result.checks.find((check) => check.name === "objectStorage")).toMatchObject({ ok: true, detail: "HTTP 403" })
    expect(result.status).toBe("ok")
  })

  it("falls back to local storage when COS is not configured", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await makeService().readiness()

    expect(result.checks.find((check) => check.name === "objectStorage")).toMatchObject({ ok: true, detail: "local storage" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("never leaks the underlying probe error into the response", async () => {
    envMock.current = { pdfRendererUrl: "http://internal-host:3010" }
    stubFetch(async () => {
      throw new Error("getaddrinfo ENOTFOUND internal-host.corp.example")
    })

    const result = await makeService().readiness()
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain("internal-host")
    expect(serialized).not.toContain("ENOTFOUND")
  })
})
