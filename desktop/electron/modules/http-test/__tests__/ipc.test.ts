import { describe, expect, it, vi } from "vitest"

import type { HttpRequestActionConfig } from "../../../../action-packages/builtin/http-request/schema"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import { sendHttpTestRequest } from "../ipc"

function config(patch: Partial<HttpRequestActionConfig> = {}): HttpRequestActionConfig {
  return {
    method: "GET",
    url: "https://example.com/api?token=sk-secret",
    bodyType: "none",
    ...patch,
  }
}

function permissionGuard(allowed: boolean): PermissionGuard {
  return {
    registerPolicy: vi.fn(),
    check: vi.fn(async () => allowed ? { allowed: true as const } : { allowed: false as const, reason: "denied by test" }),
  }
}

function auditSink(): AuditSink {
  return {
    record: vi.fn(),
    list: () => [],
    clearForTests: vi.fn(),
  }
}

describe("sendHttpTestRequest", () => {
  it("checks network permission before sending the test request", async () => {
    const guard = permissionGuard(false)
    const audit = auditSink()
    const sendRequest = vi.fn()

    await expect(sendHttpTestRequest(config(), {
      permissionGuard: guard,
      auditSink: audit,
      sendRequest,
    })).rejects.toThrow("denied by test")

    expect(guard.check).toHaveBeenCalledWith({
      action: "network.connect",
      actor: { kind: "user" },
      resource: "https://example.com/api?token=%5BREDACTED%5D",
      context: { source: "http-test" },
    })
    expect(sendRequest).not.toHaveBeenCalled()
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      actor: { kind: "user" },
      resource: "https://example.com/api?token=%5BREDACTED%5D",
      outcome: "denied",
      metadata: expect.objectContaining({
        source: "http-test",
        reason: "denied by test",
      }),
    }))
    expect(JSON.stringify(vi.mocked(audit.record).mock.calls)).not.toContain("sk-secret")
  })

  it("records allowed and failed audit events for test requests", async () => {
    const guard = permissionGuard(true)
    const audit = auditSink()
    const sendRequest = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      .mockRejectedValueOnce(new Error("network failed token=sk-secret"))

    const result = await sendHttpTestRequest(config(), {
      permissionGuard: guard,
      auditSink: audit,
      sendRequest,
    })
    expect(result.status).toBe(200)
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      resource: "https://example.com/api?token=%5BREDACTED%5D",
      outcome: "allowed",
      metadata: expect.objectContaining({
        source: "http-test",
        status: 200,
      }),
    }))

    await expect(sendHttpTestRequest(config(), {
      permissionGuard: guard,
      auditSink: audit,
      sendRequest,
    })).rejects.toThrow("network failed token=sk-secret")

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      resource: "https://example.com/api?token=%5BREDACTED%5D",
      outcome: "failed",
      metadata: expect.objectContaining({
        source: "http-test",
        error: "network failed token=[redacted]",
      }),
    }))
    expect(JSON.stringify(vi.mocked(audit.record).mock.calls)).not.toContain("sk-secret")
  })

  it("redacts URL userinfo from permission and audit resources", async () => {
    const guard = permissionGuard(true)
    const audit = auditSink()
    const sendRequest = vi.fn().mockResolvedValue({
      status: 204,
      statusText: "No Content",
      headers: {},
      body: "",
    })

    await sendHttpTestRequest(config({
      url: "https://user:secret@example.com/api?token=sk-secret",
    }), {
      permissionGuard: guard,
      auditSink: audit,
      sendRequest,
    })

    expect(guard.check).toHaveBeenCalledWith(expect.objectContaining({
      resource: "https://example.com/api?token=%5BREDACTED%5D",
    }))
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      resource: "https://example.com/api?token=%5BREDACTED%5D",
      outcome: "allowed",
    }))
    expect(JSON.stringify(vi.mocked(guard.check).mock.calls)).not.toContain("user:secret")
    expect(JSON.stringify(vi.mocked(audit.record).mock.calls)).not.toContain("user:secret")
    expect(JSON.stringify(vi.mocked(audit.record).mock.calls)).not.toContain("sk-secret")
  })
})
