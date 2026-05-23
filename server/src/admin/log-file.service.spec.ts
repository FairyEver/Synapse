import { readdir, stat } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogFileService } from "./log-file.service";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
}));

const mockedReaddir = vi.mocked(readdir);
const mockedStat = vi.mocked(stat);

describe("LogFileService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("skips log files deleted between readdir and stat", async () => {
    mockedReaddir.mockResolvedValue(["app.log", "rotated.log", "notes.txt"] as never);
    mockedStat.mockImplementation(async (path) => {
      if (String(path).endsWith("rotated.log")) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      return {
        size: 12,
        mtime: new Date("2026-05-23T00:00:00.000Z"),
      } as never;
    });

    const service = new LogFileService("/tmp/synapse-logs");

    await expect(service.listFiles()).resolves.toEqual([
      {
        name: "app.log",
        size: 12,
        modifiedAt: "2026-05-23T00:00:00.000Z",
      },
    ]);
  });

  it("keeps unexpected stat errors visible", async () => {
    mockedReaddir.mockResolvedValue(["app.log"] as never);
    mockedStat.mockRejectedValue(Object.assign(new Error("permission denied"), { code: "EACCES" }));

    const service = new LogFileService("/tmp/synapse-logs");

    await expect(service.listFiles()).rejects.toThrow("permission denied");
  });
});
