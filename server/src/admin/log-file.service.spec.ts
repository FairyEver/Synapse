import { createReadStream } from "node:fs";
import { lstat, open, readdir, readFile, realpath, unlink } from "node:fs/promises";
import { PassThrough, Readable, Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogFileService } from "./log-file.service";

const archiverMock = vi.hoisted(() => {
  let handlers: Record<string, () => void> = {};
  const archive = {
    append: vi.fn(),
    file: vi.fn(),
    finalize: vi.fn(async () => {
      handlers.end?.();
    }),
    on: vi.fn((event: string, handler: () => void) => {
      handlers[event] = handler;
      return archive;
    }),
    pipe: vi.fn(),
    pointer: vi.fn(() => 42),
  };
  return {
    archive,
    factory: vi.fn(() => archive),
    reset: () => {
      handlers = {};
      archive.append.mockClear();
      archive.file.mockClear();
      archive.finalize.mockClear();
      archive.on.mockClear();
      archive.pipe.mockClear();
      archive.pointer.mockClear();
      archive.pointer.mockReturnValue(42);
    },
  };
});

vi.mock("node:fs/promises", () => ({
  lstat: vi.fn(),
  open: vi.fn(),
  readdir: vi.fn(),
  realpath: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock("node:fs", () => ({
  createReadStream: vi.fn(),
}));

vi.mock("archiver", () => ({
  default: archiverMock.factory,
}));

const mockedCreateReadStream = vi.mocked(createReadStream);
const mockedLstat = vi.mocked(lstat);
const mockedOpen = vi.mocked(open);
const mockedReaddir = vi.mocked(readdir);
const mockedReadFile = vi.mocked(readFile);
const mockedRealpath = vi.mocked(realpath);
const mockedUnlink = vi.mocked(unlink);

describe("LogFileService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    archiverMock.reset();
    mockedRealpath.mockImplementation(async (path) => String(path) as never);
    mockedCreateReadStream.mockReturnValue(Readable.from([""]) as never);
  });

  it("skips log files deleted between readdir and lstat", async () => {
    mockedReaddir.mockResolvedValue(["app.log", "rotated.log", "notes.txt"] as never);
    mockedLstat.mockImplementation(async (path) => {
      if (String(path).endsWith("rotated.log")) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      return {
        size: 12,
        mtime: new Date("2026-05-23T00:00:00.000Z"),
        isFile: () => true,
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

  it("keeps unexpected lstat errors visible", async () => {
    mockedReaddir.mockResolvedValue(["app.log"] as never);
    mockedLstat.mockRejectedValue(Object.assign(new Error("permission denied"), { code: "EACCES" }));

    const service = new LogFileService("/tmp/synapse-logs");

    await expect(service.listFiles()).rejects.toThrow("permission denied");
  });

  it("treats missing log directories as empty", async () => {
    mockedReaddir.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));

    const service = new LogFileService("/tmp/synapse-logs");

    await expect(service.listFiles()).resolves.toEqual([]);
  });

  it("keeps unexpected log directory read errors visible", async () => {
    mockedReaddir.mockRejectedValue(Object.assign(new Error("permission denied"), { code: "EACCES" }));

    const service = new LogFileService("/tmp/synapse-logs");

    await expect(service.listFiles()).rejects.toThrow("permission denied");
    expect(mockedLstat).not.toHaveBeenCalled();
  });

  it("reads recent entries from the file tail without loading the whole file", async () => {
    const entry = JSON.stringify({ time: "2026-05-23T01:00:00.000Z", level: 30, msg: "ready" });
    const content = `${"not-json\n".repeat(20_000)}${entry}\n`;
    const handle = mockReadableFile(content);
    mockedReaddir.mockResolvedValue(["app.log"] as never);
    mockedLstat.mockResolvedValue({
      size: Buffer.byteLength(content),
      mtime: new Date("2026-05-23T00:00:00.000Z"),
      isFile: () => true,
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

  it("redacts sensitive values, URLs, and user paths from recent log entries", async () => {
    const entry = JSON.stringify({
      time: "2026-05-23T01:00:00.000Z",
      level: 50,
      msg: "request failed Authorization: Bearer raw-bearer ANTHROPIC_API_KEY=env-secret https://example.com/invite?token=invite-secret",
      req: {
        method: "GET",
        url: "/share/share-1?password=plain-password&apiKey=plain-api-key&file=/Users/liyang/project/readme.md",
      },
      err: {
        message: "{\"token\":\"json-token\",\"apiKey\":\"json-api-key\"}",
        stack: "Error: Cookie: sid=cookie-secret\n    at run (/Users/liyang/project/app.ts:1:1)",
      },
    });
    mockReadableFile(`${entry}\n`);
    mockedReaddir.mockResolvedValue(["app.log"] as never);
    mockedLstat.mockResolvedValue({
      size: Buffer.byteLength(entry) + 1,
      mtime: new Date("2026-05-23T00:00:00.000Z"),
      isFile: () => true,
    } as never);
    const service = new LogFileService("/tmp/synapse-logs");

    const result = await service.readRecent({ limit: 1 });
    const serialized = JSON.stringify(result);

    expect(result[0]).toEqual({
      time: "2026-05-23T01:00:00.000Z",
      level: "error",
      msg: "request failed Authorization: [REDACTED] ANTHROPIC_API_KEY=[REDACTED] [URL]",
      req: {
        method: "GET",
        url: "/share/share-1?password=[REDACTED]&apiKey=[REDACTED]&file=[PATH]",
      },
      err: {
        message: "{\"token\":\"[REDACTED]\",\"apiKey\":\"[REDACTED]\"}",
        stack: "Error: Cookie: [REDACTED]\n    at run ([PATH])",
      },
    });
    expect(serialized).not.toContain("raw-bearer");
    expect(serialized).not.toContain("env-secret");
    expect(serialized).not.toContain("plain-password");
    expect(serialized).not.toContain("plain-api-key");
    expect(serialized).not.toContain("json-token");
    expect(serialized).not.toContain("json-api-key");
    expect(serialized).not.toContain("cookie-secret");
    expect(serialized).not.toContain("example.com");
    expect(serialized).not.toContain("invite-secret");
    expect(serialized).not.toContain("/Users/liyang/project/readme.md");
    expect(serialized).not.toContain("/Users/liyang/project/app.ts");
    expect(serialized).toContain("[URL]");
    expect(serialized).toContain("[PATH]");
  });

  it("filters recent entries by date range", async () => {
    const oldEntry = JSON.stringify({ time: "2026-05-21T23:00:00.000Z", level: 30, msg: "old" });
    const keptEntry = JSON.stringify({ time: "2026-05-23T01:00:00.000Z", level: 30, msg: "kept" });
    const newEntry = JSON.stringify({ time: "2026-05-24T01:00:00.000Z", level: 30, msg: "new" });
    const content = `${oldEntry}\n${keptEntry}\n${newEntry}\n`;
    mockReadableFile(content);
    mockedReaddir.mockResolvedValue(["app.log"] as never);
    mockedLstat.mockResolvedValue({
      size: Buffer.byteLength(content),
      mtime: new Date("2026-05-24T00:00:00.000Z"),
      isFile: () => true,
    } as never);

    const service = new LogFileService("/tmp/synapse-logs");

    await expect(service.readRecent({ from: "2026-05-22", to: "2026-05-23" })).resolves.toEqual([
      {
        time: "2026-05-23T01:00:00.000Z",
        level: "info",
        msg: "kept",
      },
    ]);
  });

  it("reports cleanup failures when one log file cannot be deleted", async () => {
    mockedReaddir.mockResolvedValue(["server.2026-05-01.log", "server.2026-05-02.log"] as never);
    mockedLstat.mockResolvedValue({
      size: 12,
      mtime: new Date("2026-05-23T00:00:00.000Z"),
      isFile: () => true,
    } as never);
    mockedUnlink.mockImplementation(async (path) => {
      if (String(path).endsWith("server.2026-05-01.log")) {
        throw new Error("permission denied");
      }
      return undefined;
    });
    const service = new LogFileService("/tmp/synapse-logs");

    await expect(service.cleanup("2026-05-03")).resolves.toEqual({
      deleted: 1,
      failures: [{
        name: "server.2026-05-01.log",
        errorName: "Error",
      }],
    });

    expect(mockedUnlink).toHaveBeenCalledTimes(2);
  });

  it("treats cleanup ENOENT as already deleted by another request", async () => {
    mockedReaddir.mockResolvedValue(["server.2026-05-01.log", "server.2026-05-02.log"] as never);
    mockedLstat.mockResolvedValue({
      size: 12,
      mtime: new Date("2026-05-23T00:00:00.000Z"),
      isFile: () => true,
    } as never);
    mockedUnlink.mockImplementation(async (path) => {
      if (String(path).endsWith("server.2026-05-01.log")) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      return undefined;
    });
    const service = new LogFileService("/tmp/synapse-logs");

    await expect(service.cleanup("2026-05-03")).resolves.toEqual({
      deleted: 2,
      failures: [],
    });

    expect(mockedUnlink).toHaveBeenCalledTimes(2);
  });

  it("streams log zip data to the provided writable without buffering the archive", async () => {
    mockedReaddir.mockResolvedValue(["server.2026-05-01.log", "server.2026-05-02.log"] as never);
    mockedLstat.mockResolvedValue({
      size: 12,
      mtime: new Date("2026-05-23T00:00:00.000Z"),
      isFile: () => true,
    } as never);
    const service = new LogFileService("/tmp/synapse-logs");
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    await expect(service.streamZipTo(output, { from: "2026-05-01", to: "2026-05-02" }))
      .resolves
      .toEqual({ bytes: 42, fileCount: 2 });

    expect(archiverMock.archive.pipe).toHaveBeenCalledWith(output);
    expect(archiverMock.archive.file).not.toHaveBeenCalled();
    expect(archiverMock.archive.append).toHaveBeenCalledTimes(2);
    expect(archiverMock.archive.finalize).toHaveBeenCalledWith();
    expect(mockedReadFile).not.toHaveBeenCalled();
  });

  it("redacts sensitive values before adding log files to zip downloads", async () => {
    mockedReaddir.mockResolvedValue(["server.2026-05-01.log"] as never);
    mockedLstat.mockResolvedValue({
      size: 12,
      mtime: new Date("2026-05-23T00:00:00.000Z"),
      isFile: () => true,
    } as never);
    const source = new PassThrough();
    mockedCreateReadStream.mockReturnValue(source as never);
    const service = new LogFileService("/tmp/synapse-logs");
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    await expect(service.streamZipTo(output, { from: "2026-05-01", to: "2026-05-01" }))
      .resolves
      .toEqual({ bytes: 42, fileCount: 1 });

    expect(archiverMock.archive.file).not.toHaveBeenCalled();
    expect(archiverMock.archive.append).toHaveBeenCalledTimes(1);
    expect(archiverMock.archive.append).toHaveBeenCalledWith(
      expect.anything(),
      { name: "server.2026-05-01.log" },
    );
    const [entryStream] = archiverMock.archive.append.mock.calls[0];
    source.end(
      "request failed Authorization: Bearer raw-bearer "
        + "ANTHROPIC_API_KEY=env-secret https://example.com/reset?token=reset-secret file=/Users/liyang/project/readme.md\n"
        + "{\"token\":\"json-token\",\"apiKey\":\"json-api-key\"}",
    );
    const content = await readStreamToString(entryStream as Readable);
    expect(content).toContain("Authorization: [REDACTED]");
    expect(content).toContain("ANTHROPIC_API_KEY=[REDACTED]");
    expect(content).toContain("[URL]");
    expect(content).toContain("file=[PATH]");
    expect(content).toContain("\"token\":\"[REDACTED]\"");
    expect(content).toContain("\"apiKey\":\"[REDACTED]\"");
    expect(content).not.toContain("raw-bearer");
    expect(content).not.toContain("env-secret");
    expect(content).not.toContain("example.com");
    expect(content).not.toContain("reset-secret");
    expect(content).not.toContain("/Users/liyang/project/readme.md");
    expect(content).not.toContain("json-token");
    expect(content).not.toContain("json-api-key");
  });

  it("includes active log files in bounded zip downloads by modified date", async () => {
    mockedReaddir.mockResolvedValue([
      "server.log",
      "server.2026-05-01.log",
      "server.2026-05-03.log",
    ] as never);
    mockedLstat.mockImplementation(async (path) => {
      const name = String(path).split("/").at(-1);
      return {
        size: 12,
        mtime: new Date(name === "server.log"
          ? "2026-05-02T12:00:00.000Z"
          : "2026-05-23T00:00:00.000Z"),
        isFile: () => true,
      } as never;
    });
    const service = new LogFileService("/tmp/synapse-logs");
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    await expect(service.streamZipTo(output, { from: "2026-05-02", to: "2026-05-02" }))
      .resolves
      .toEqual({ bytes: 42, fileCount: 1 });

    expect(archiverMock.archive.file).not.toHaveBeenCalled();
    expect(archiverMock.archive.append).toHaveBeenCalledTimes(1);
    expect(archiverMock.archive.append).toHaveBeenCalledWith(
      expect.anything(),
      { name: "server.log" },
    );
  });

  it("does not include symlinked log entries in zip downloads", async () => {
    mockedReaddir.mockResolvedValue(["server.2026-05-01.log", "secret.2026-05-01.log"] as never);
    mockedLstat.mockImplementation(async (path) => ({
      size: 12,
      mtime: new Date("2026-05-23T00:00:00.000Z"),
      isFile: () => !String(path).endsWith("secret.2026-05-01.log"),
    }) as never);
    const service = new LogFileService("/tmp/synapse-logs");
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    await expect(service.streamZipTo(output, { from: "2026-05-01", to: "2026-05-01" }))
      .resolves
      .toEqual({ bytes: 42, fileCount: 1 });

    expect(archiverMock.archive.file).not.toHaveBeenCalled();
    expect(archiverMock.archive.append).toHaveBeenCalledTimes(1);
    expect(archiverMock.archive.append).toHaveBeenCalledWith(
      expect.anything(),
      { name: "server.2026-05-01.log" },
    );
  });

  it("does not include resolved log paths outside the log directory", async () => {
    mockedReaddir.mockResolvedValue(["server.2026-05-01.log"] as never);
    mockedLstat.mockResolvedValue({
      size: 12,
      mtime: new Date("2026-05-23T00:00:00.000Z"),
      isFile: () => true,
    } as never);
    mockedRealpath.mockImplementation(async (path) => (
      String(path).endsWith("server.2026-05-01.log")
        ? "/tmp/outside/server.2026-05-01.log"
        : String(path)
    ) as never);
    const service = new LogFileService("/tmp/synapse-logs");
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    await expect(service.streamZipTo(output, { from: "2026-05-01", to: "2026-05-01" }))
      .resolves
      .toEqual({ bytes: 42, fileCount: 0 });

    expect(archiverMock.archive.file).not.toHaveBeenCalled();
    expect(archiverMock.archive.append).not.toHaveBeenCalled();
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

async function readStreamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}
