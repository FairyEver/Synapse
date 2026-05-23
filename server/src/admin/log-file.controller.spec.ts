import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { LogFileController } from "./log-file.controller";
import type { LogFileService } from "./log-file.service";
import type { AuditLogService } from "../common/audit-log.service";

function createController() {
  const service = {
    cleanup: vi.fn().mockResolvedValue(2),
    listFiles: vi.fn().mockResolvedValue([{ name: "server.log", size: 123, modifiedAt: "2026-05-23T00:00:00.000Z" }]),
    readRecent: vi.fn().mockResolvedValue([]),
    streamZipTo: vi.fn().mockResolvedValue({ bytes: 9, fileCount: 2 }),
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
  it("records audit logs for file list reads", async () => {
    const { controller, auditLog, service } = createController();

    await expect(controller.listFiles({
      admin: { email: "admin@example.com" },
      ip: "203.0.113.10",
    } as never)).resolves.toEqual([{ name: "server.log", size: 123, modifiedAt: "2026-05-23T00:00:00.000Z" }]);

    expect(service.listFiles).toHaveBeenCalled();
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "logs.list_files",
      targetType: "logs",
      targetId: "files",
      detail: { count: 1 },
      ipAddress: "203.0.113.10",
    });
  });

  it("caps recent log limit", async () => {
    const { controller, service } = createController();

    await controller.getRecent(undefined, "999999999");

    expect(service.readRecent).toHaveBeenCalledWith({ level: undefined, limit: 1000 });
  });

  it("records audit logs for recent log reads", async () => {
    const { controller, auditLog, service } = createController();
    service.readRecent.mockResolvedValueOnce([
      { time: "2026-05-23T00:00:00.000Z", level: "error", msg: "failed" },
    ]);

    await expect(controller.getRecent("error", "50", {
      admin: { email: "admin@example.com" },
      ip: "203.0.113.10",
    } as never)).resolves.toEqual([
      { time: "2026-05-23T00:00:00.000Z", level: "error", msg: "failed" },
    ]);

    expect(service.readRecent).toHaveBeenCalledWith({ level: "error", limit: 50 });
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "logs.recent",
      targetType: "logs",
      targetId: "recent",
      detail: { level: "error", limit: 50, count: 1 },
      ipAddress: "203.0.113.10",
    });
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

  it("records audit logs for downloads", async () => {
    const { controller, auditLog, service } = createController();
    const response = {
      set: vi.fn(),
      send: vi.fn(),
    };

    await controller.download("2026-05-01", "2026-05-23", response as never, {
      admin: { email: "admin@example.com" },
      ip: "203.0.113.10",
    } as never);

    expect(service.streamZipTo).toHaveBeenCalledWith(response, { from: "2026-05-01", to: "2026-05-23" });
    expect(response.set).toHaveBeenCalledWith({
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=\"logs-2026-05-01-2026-05-23.zip\"",
    });
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "logs.download",
      targetType: "logs",
      targetId: "logs-2026-05-01-2026-05-23.zip",
      detail: {
        from: "2026-05-01",
        to: "2026-05-23",
        filename: "logs-2026-05-01-2026-05-23.zip",
        bytes: 9,
        fileCount: 2,
      },
      ipAddress: "203.0.113.10",
    });
    expect(response.send).not.toHaveBeenCalled();
  });
});
