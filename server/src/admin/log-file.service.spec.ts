import { open, readdir, readFile, stat, unlink } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogFileService } from "./log-file.service";

vi.mock("node:fs/promises", () => ({
  open: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
}));

const mockedOpen = vi.mocked(open);
const mockedReaddir = vi.mocked(readdir);
const mockedReadFile = vi.mocked(readFile);
const mockedStat = vi.mocked(stat);
const mockedUnlink = vi.mocked(unlink);

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

  it("reads recent entries from the file tail without loading the whole file", async () => {
    const entry = JSON.stringify({ time: "2026-05-23T01:00:00.000Z", level: 30, msg: "ready" });
    const content = `${"not-json\n".repeat(20_000)}${entry}\n`;
    const handle = mockReadableFile(content);
    mockedReaddir.mockResolvedValue(["app.log"] as never);
    mockedStat.mockResolvedValue({
      size: Buffer.byteLength(content),
      mtime: new Date("2026-05-23T00:00:00.000Z"),
    } as never);

    const service = new LogFileService("/tmp/synapse-logs");

    await expect(service.readRecent({ limit: 1 })).resolves.toEqual([
      {
        time: "2026-05-23T01:00:00.000Z",
        level: "info",
        msg: "ready",
      },
    ]);
    expect(mockedReadFile).not.toHaveBeenCalled();
    expect(handle.read).toHaveBeenCalledTimes(1);
  });

  it("continues cleanup when one log file cannot be deleted", async () => {
    mockedReaddir.mockResolvedValue(["server.2026-05-01.log", "server.2026-05-02.log"] as never);
    mockedStat.mockResolvedValue({
      size: 12,
      mtime: new Date("2026-05-23T00:00:00.000Z"),
    } as never);
    mockedUnlink.mockImplementation(async (path) => {
      if (String(path).endsWith("server.2026-05-01.log")) {
        throw new Error("permission denied");
      }
      return undefined;
    });
    const service = new LogFileService("/tmp/synapse-logs");

    await expect(service.cleanup("2026-05-03")).resolves.toBe(1);

    expect(mockedUnlink).toHaveBeenCalledTimes(2);
  });
});

function mockReadableFile(content: string) {
  const bytes = Buffer.from(content);
  const handle = {
    read: vi.fn(async (target: Buffer, offset: number, length: number, position: number) => {
      const chunk = bytes.subarray(position, position + length);
      chunk.copy(target, offset);
      return { bytesRead: chunk.length, buffer: target };
    }),
    close: vi.fn(async () => undefined),
  };
  mockedOpen.mockResolvedValue(handle as never);
  return handle;
}
