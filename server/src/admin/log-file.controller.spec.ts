import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { LogFileController } from "./log-file.controller";
import type { LogFileService } from "./log-file.service";
import type { AuditLogService } from "../common/audit-log.service";

function createController() {
  const service = {
    cleanup: vi.fn().mockResolvedValue(2),
    readRecent: vi.fn().mockResolvedValue([]),
  };
  const auditLog = {
    record: vi.fn().mockResolvedValue(undefined),
  };
  return {
    controller: new LogFileController(
      service as unknown as LogFileService,
      auditLog as unknown as AuditLogService,
    ),
    auditLog,
    service,
  };
}

describe("LogFileController", () => {
  it("caps recent log limit", async () => {
    const { controller, service } = createController();

    await controller.getRecent(undefined, "999999999");

    expect(service.readRecent).toHaveBeenCalledWith({ level: undefined, limit: 1000 });
  });

  it("rejects non-numeric recent log limit", async () => {
    const { controller } = createController();

    await expect(controller.getRecent(undefined, "abc"))
      .rejects
      .toBeInstanceOf(BadRequestException);
  });

  it("records audit logs for cleanup", async () => {
    const { controller, auditLog, service } = createController();

    await expect(controller.cleanup("2026-05-01", {
      admin: { email: "admin@example.com" },
      ip: "203.0.113.10",
    } as never)).resolves.toEqual({ deleted: 2 });

    expect(service.cleanup).toHaveBeenCalledWith("2026-05-01");
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "logs.cleanup",
      targetType: "logs",
      targetId: "2026-05-01",
      detail: { before: "2026-05-01", deleted: 2 },
      ipAddress: "203.0.113.10",
    });
  });
});
