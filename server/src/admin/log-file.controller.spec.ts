import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { LogFileController } from "./log-file.controller";
import type { LogFileService } from "./log-file.service";

function createController() {
  const service = {
    readRecent: vi.fn().mockResolvedValue([]),
  };
  return {
    controller: new LogFileController(service as unknown as LogFileService),
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
});
