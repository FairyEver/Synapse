import { GUARDS_METADATA } from "@nestjs/common/constants"
import { UnauthorizedException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import {
  ClientTelemetryAdminController,
  ClientTelemetryController,
} from "./client-telemetry.controller"
import type { ClientTelemetryService } from "./client-telemetry.service"
import type { UserAuthService } from "../auth/user-auth.service"
import type { AuditLogService } from "../common/audit-log.service"

const event = {
  eventId: "event-1",
  category: "interaction",
  eventKey: "button.click",
  component: "button",
  action: "click",
  windowType: "main",
  clientInstanceId: "client-1",
  sessionId: "session-1",
  appVersion: "0.2.419",
  platform: "darwin-arm64",
  occurredAt: "2026-09-01T00:00:00.000Z",
}

describe("ClientTelemetryController", () => {
  it("stores anonymous events without a user", async () => {
    const ingest = vi.fn().mockResolvedValue({ accepted: 1, duplicates: 0 })
    const controller = new ClientTelemetryController(
      { ingest } as unknown as ClientTelemetryService,
      { verifyAccessToken: vi.fn() } as unknown as UserAuthService,
    )

    await controller.ingest({ body: { events: [event] }, headers: {} } as never)

    expect(ingest).toHaveBeenCalledWith(null, [event])
  })

  it("derives the user from a valid bearer token", async () => {
    const ingest = vi.fn().mockResolvedValue({ accepted: 1, duplicates: 0 })
    const verifyAccessToken = vi.fn().mockResolvedValue({ userId: "user-1" })
    const controller = new ClientTelemetryController(
      { ingest } as unknown as ClientTelemetryService,
      { verifyAccessToken } as unknown as UserAuthService,
    )

    await controller.ingest({
      body: { events: [event] },
      headers: { authorization: "Bearer token-1" },
    } as never)

    expect(verifyAccessToken).toHaveBeenCalledWith("token-1")
    expect(ingest).toHaveBeenCalledWith("user-1", [event])
  })

  it("rejects malformed authorization instead of treating it as anonymous", async () => {
    const controller = new ClientTelemetryController(
      { ingest: vi.fn() } as unknown as ClientTelemetryService,
      { verifyAccessToken: vi.fn() } as unknown as UserAuthService,
    )

    await expect(controller.ingest({
      body: { events: [event] },
      headers: { authorization: "Basic token-1" },
    } as never)).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it("propagates invalid bearer token rejection instead of treating it as anonymous", async () => {
    const controller = new ClientTelemetryController(
      { ingest: vi.fn() } as unknown as ClientTelemetryService,
      {
        verifyAccessToken: vi.fn().mockRejectedValue(new UnauthorizedException("认证已失效。")),
      } as unknown as UserAuthService,
    )

    await expect(controller.ingest({
      body: { events: [event] },
      headers: { authorization: "Bearer expired-token" },
    } as never)).rejects.toBeInstanceOf(UnauthorizedException)
  })
})

describe("ClientTelemetryAdminController", () => {
  it("keeps telemetry statistics behind the administrator guard", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ClientTelemetryAdminController)).toContain(AdminAuthGuard)
  })

  it("returns aggregate statistics and audits the read", async () => {
    const getStats = vi.fn().mockResolvedValue({ summary: { events: 3 } })
    const record = vi.fn().mockResolvedValue(undefined)
    const controller = new ClientTelemetryAdminController(
      { getStats } as unknown as ClientTelemetryService,
      { record } as unknown as AuditLogService,
    )

    await expect(controller.stats(
      {
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-09-01T00:00:00.000Z",
      },
      { admin: { sessionId: "admin-session" }, ip: "203.0.113.1" } as never,
    )).resolves.toEqual({ summary: { events: 3 } })

    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.telemetry.stats",
      targetType: "client_telemetry",
      targetId: "stats",
    }))
  })
})
