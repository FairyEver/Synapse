import { describe, expect, it, vi } from "vitest";
import { LogFileController } from "./log-file.controller";
import type { LogFileService } from "./log-file.service";
import type { AuditLogService } from "../common/audit-log.service";

function createController() {
  const service = {
    cleanup: vi.fn().mockResolvedValue({ deleted: 2, failures: [] }),
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

function cleanupRetentionCutoff(): string {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  return cutoff.toISOString().slice(0, 10);
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

    await controller.getRecent(undefined, undefined, "999999999");

    expect(service.readRecent).toHaveBeenCalledWith({ from: undefined, level: undefined, limit: 1000, to: undefined });
  });

  it("records audit logs for recent log reads", async () => {
    const { controller, auditLog, service } = createController();
    service.readRecent.mockResolvedValueOnce([
      { time: "2026-05-23T00:00:00.000Z", level: "error", msg: "failed" },
    ]);

    await expect(controller.getRecent("2026-05-01", "error", "50", "2026-05-23", {
      admin: { email: "admin@example.com" },
      ip: "203.0.113.10",
    } as never)).resolves.toEqual([
      { time: "2026-05-23T00:00:00.000Z", level: "error", msg: "failed" },
    ]);

    expect(service.readRecent).toHaveBeenCalledWith({ from: "2026-05-01", level: "error", limit: 50, to: "2026-05-23" });
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "logs.recent",
      targetType: "logs",
      targetId: "recent",
      detail: { from: "2026-05-01", level: "error", limit: 50, to: "2026-05-23", count: 1 },
      ipAddress: "203.0.113.10",
    });
  });

  it("rejects reversed recent log date ranges before reading logs", async () => {
    const { controller, service } = createController();

    await expect(controller.getRecent("2026-05-23", undefined, "50", "2026-05-01"))
      .rejects
      .toThrow("from 不能晚于 to。");
    expect(service.readRecent).not.toHaveBeenCalled();
  });

  it("rejects non-numeric recent log limit", async () => {
    const { controller } = createController();

    await expect(controller.getRecent(undefined, undefined, "abc"))
      .rejects
      .toThrow("limit 参数必须为数字。");
  });

  it("rejects invalid recent log levels with a localized message", async () => {
    const { controller } = createController();

    await expect(controller.getRecent(undefined, "trace", "50"))
      .rejects
      .toThrow("无效的日志级别：trace");
  });

  it("rejects invalid cleanup dates with a localized message", async () => {
    const { controller, service } = createController();

    await expect(controller.cleanup("2026/05/01"))
      .rejects
      .toThrow("before 参数必须为 YYYY-MM-DD 格式。");
    expect(service.cleanup).not.toHaveBeenCalled();
  });

  it("rejects impossible cleanup dates with a localized message", async () => {
    const { controller, service } = createController();

    await expect(controller.cleanup("2026-02-31"))
      .rejects
      .toThrow("before 参数必须为有效日期。");
    expect(service.cleanup).not.toHaveBeenCalled();
  });

  it("rejects future cleanup dates before deleting log files", async () => {
    const { controller, service } = createController();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    await expect(controller.cleanup(tomorrow))
      .rejects
      .toThrow("before 不能是未来日期。");
    expect(service.cleanup).not.toHaveBeenCalled();
  });

  it("rejects cleanup dates newer than the retention floor before deleting log files", async () => {
    const { controller, service } = createController();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    await expect(controller.cleanup(yesterday))
      .rejects
      .toThrow("before 不能晚于最近 30 天。");
    expect(service.cleanup).not.toHaveBeenCalled();
  });

  it("allows cleanup dates at or older than the retention floor", async () => {
    const { controller, service } = createController();
    const cutoff = cleanupRetentionCutoff();

    await expect(controller.cleanup(cutoff)).resolves.toEqual({ deleted: 2 });
    expect(service.cleanup).toHaveBeenCalledWith(cutoff);
  });

  it("records audit logs for cleanup", async () => {
    const { controller, auditLog, service } = createController();
    const cutoff = cleanupRetentionCutoff();

    await expect(controller.cleanup(cutoff, {
      admin: { email: "admin@example.com" },
      ip: "203.0.113.10",
    } as never)).resolves.toEqual({ deleted: 2 });

    expect(service.cleanup).toHaveBeenCalledWith(cutoff);
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "logs.cleanup",
      targetType: "logs",
      targetId: cutoff,
      detail: { before: cutoff, deleted: 2 },
      ipAddress: "203.0.113.10",
    });
  });

  it("keeps cleanup responses when audit writes fail", async () => {
    const { controller, auditLog, service } = createController();
    const cutoff = cleanupRetentionCutoff();
    auditLog.record.mockRejectedValueOnce(new Error("audit database unavailable"));

    await expect(controller.cleanup(cutoff, {
      admin: { email: "admin@example.com" },
      ip: "203.0.113.10",
    } as never)).resolves.toEqual({ deleted: 2 });

    expect(service.cleanup).toHaveBeenCalledWith(cutoff);
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "logs.cleanup",
      targetType: "logs",
      targetId: cutoff,
    }));
  });

  it("returns partial cleanup results and records failed cleanup audits", async () => {
    const { controller, auditLog, service } = createController();
    const cutoff = cleanupRetentionCutoff();
    service.cleanup.mockResolvedValueOnce({
      deleted: 1,
      failures: [{ name: "server.2026-05-01.log", errorName: "Error" }],
    });

    await expect(controller.cleanup(cutoff, {
      admin: { email: "admin@example.com" },
      ip: "203.0.113.10",
    } as never)).resolves.toEqual({ deleted: 1, failures: 1 });

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "logs.cleanup.failed",
      targetType: "logs",
      targetId: cutoff,
      detail: {
        before: cutoff,
        deleted: 1,
        failures: [{ name: "server.2026-05-01.log", errorName: "Error" }],
      },
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

  it("answers log download HEAD checks without streaming or writing audit logs", () => {
    const { controller, auditLog, service } = createController();
    const response = {
      end: vi.fn(),
      set: vi.fn(),
    };

    controller.checkDownload("2026-05-01", "2026-05-23", response as never);

    expect(service.streamZipTo).not.toHaveBeenCalled();
    expect(response.set).toHaveBeenCalledWith({
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=\"logs-2026-05-01-2026-05-23.zip\"",
    });
    expect(response.end).toHaveBeenCalledOnce();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it("records failed downloads without rethrowing after headers are sent", async () => {
    const { controller, auditLog, service } = createController();
    const error = Object.assign(new Error("zip stream failed at /var/log/synapse/server.2026-05-23.log"), {
      code: "EACCES",
    });
    service.streamZipTo.mockRejectedValueOnce(error);
    const response = {
      set: vi.fn(),
      headersSent: true,
      destroyed: false,
      destroy: vi.fn(),
    };

    await expect(controller.download("2026-05-01", "2026-05-23", response as never, {
      admin: { email: "admin@example.com" },
      ip: "203.0.113.10",
    } as never)).resolves.toBeUndefined();

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "logs.download.failed",
      targetType: "logs",
      targetId: "logs-2026-05-01-2026-05-23.zip",
      detail: {
        from: "2026-05-01",
        to: "2026-05-23",
        filename: "logs-2026-05-01-2026-05-23.zip",
        failure: "stream_error",
        errorName: "Error",
        errorCode: "EACCES",
      },
      ipAddress: "203.0.113.10",
    });
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain("/var/log/synapse");
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain("server.2026-05-23.log");
    expect(response.destroy).toHaveBeenCalledWith(error);
  });

  it("rethrows download stream errors before headers are sent", async () => {
    const { controller, auditLog, service } = createController();
    const error = new Error("zip stream failed at /var/log/synapse/server.2026-05-23.log");
    service.streamZipTo.mockRejectedValueOnce(error);
    const response = {
      set: vi.fn(),
      headersSent: false,
    };

    await expect(controller.download("2026-05-01", "2026-05-23", response as never, {
      admin: { email: "admin@example.com" },
      ip: "203.0.113.10",
    } as never))
      .rejects
      .toThrow("zip stream failed");
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it("rejects invalid download dates before streaming logs", async () => {
    const { controller, service, auditLog } = createController();
    const response = { set: vi.fn(), send: vi.fn() };

    await expect(controller.download("2026/05/01", undefined, response as never))
      .rejects
      .toThrow("from 参数必须为 YYYY-MM-DD 格式。");

    expect(service.streamZipTo).not.toHaveBeenCalled();
    expect(response.set).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it("rejects impossible download dates before streaming logs", async () => {
    const { controller, service } = createController();
    const response = { set: vi.fn(), send: vi.fn() };

    await expect(controller.download(undefined, "2026-02-31", response as never))
      .rejects
      .toThrow("to 参数必须为有效日期。");

    expect(service.streamZipTo).not.toHaveBeenCalled();
  });

  it("rejects reversed download date ranges before streaming logs", async () => {
    const { controller, service } = createController();
    const response = { set: vi.fn(), send: vi.fn() };

    await expect(controller.download("2026-05-23", "2026-05-01", response as never))
      .rejects
      .toThrow("from 不能晚于 to。");

    expect(service.streamZipTo).not.toHaveBeenCalled();
  });
});
