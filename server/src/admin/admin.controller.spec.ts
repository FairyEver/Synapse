import { describe, expect, it, vi } from "vitest"
import { BadRequestException } from "@nestjs/common"
import { AdminController } from "./admin.controller"
import type { AdminService } from "./admin.service"
import type { AuditLogService } from "../common/audit-log.service"

const mockAuditLog = {} as AuditLogService

function createController(service: Partial<AdminService>) {
  return new AdminController(service as AdminService, mockAuditLog)
}

describe("AdminController", () => {
  it("passes the activation code archive filter to the service", async () => {
    const listActivationCodes = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 })
    const controller = createController({ listActivationCodes })

    await controller.listActivationCodes({ includeArchived: "true" })

    expect(listActivationCodes).toHaveBeenCalled()
  })

  it("creates activation codes without accepting manual code input", async () => {
    const createActivationCode = vi.fn().mockResolvedValue([
      { id: "code_1", code: "SYN-TEST-0001", maxDevices: 2 },
    ])
    const controller = createController({ createActivationCode })

    await controller.createActivationCode({
      maxDevices: 2,
      expiresAt: null,
      quantity: 3,
    })

    expect(createActivationCode).toHaveBeenCalledWith({
      maxDevices: 2,
      expiresAt: null,
      quantity: 3,
    })
  })

  it("rejects manually provided activation codes", () => {
    const createActivationCode = vi.fn()
    const controller = createController({ createActivationCode })

    expect(() => controller.createActivationCode({
      code: "MANUAL-CODE",
      maxDevices: 1,
    })).toThrow(BadRequestException)
    expect(createActivationCode).not.toHaveBeenCalled()
  })

  it("rejects activation code batches over 100", () => {
    const createActivationCode = vi.fn()
    const controller = createController({ createActivationCode })

    expect(() => controller.createActivationCode({
      maxDevices: 1,
      quantity: 101,
    })).toThrow(BadRequestException)
    expect(createActivationCode).not.toHaveBeenCalled()
  })

  it("archives activation codes", async () => {
    const archiveActivationCode = vi.fn().mockResolvedValue({ id: "code_1" })
    const controller = createController({ archiveActivationCode })

    await controller.archiveActivationCode("code_1")

    expect(archiveActivationCode).toHaveBeenCalledWith("code_1")
  })

  it("lists activation attempts", async () => {
    const listActivationAttempts = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 })
    const controller = createController({ listActivationAttempts })

    await controller.listActivationAttempts("code_1", {})

    expect(listActivationAttempts).toHaveBeenCalled()
  })

  it("updates risk lock state", async () => {
    const updateActivationCodeRiskLock = vi.fn().mockResolvedValue({ id: "code_1" })
    const controller = createController({ updateActivationCodeRiskLock })

    await controller.updateActivationCodeRiskLock("code_1", {
      locked: false,
      note: "确认正常",
    })

    expect(updateActivationCodeRiskLock).toHaveBeenCalledWith("code_1", {
      locked: false,
      note: "确认正常",
    })
  })

  it("rejects invalid risk lock requests", () => {
    const updateActivationCodeRiskLock = vi.fn()
    const controller = createController({ updateActivationCodeRiskLock })

    expect(() => controller.updateActivationCodeRiskLock("code_1", {
      locked: "false",
    })).toThrow(BadRequestException)
    expect(updateActivationCodeRiskLock).not.toHaveBeenCalled()
  })

  it("replaces activation codes", async () => {
    const replaceActivationCode = vi.fn().mockResolvedValue({
      id: "new_code",
      code: "SYN-NEWC-0001",
      maxDevices: 1,
    })
    const controller = createController({ replaceActivationCode })

    await controller.replaceActivationCode("old_code")

    expect(replaceActivationCode).toHaveBeenCalledWith("old_code")
  })
})