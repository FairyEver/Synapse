import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import { LogFileService } from "../src/admin/log-file.service";

const TEST_LOG_DIR = join(process.cwd(), "test-logs");

function writeTestLog(name: string, lines: object[]) {
  writeFileSync(
    join(TEST_LOG_DIR, name),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
}

describe("LogFileService", () => {
  let service: LogFileService;

  beforeEach(() => {
    mkdirSync(TEST_LOG_DIR, { recursive: true });
    service = new LogFileService(TEST_LOG_DIR);
  });

  afterEach(() => {
    rmSync(TEST_LOG_DIR, { recursive: true, force: true });
  });

  describe("listFiles", () => {
    it("returns files sorted by modification time descending", async () => {
      writeTestLog("server.2026-05-01.log", [{ time: 1, level: 30, msg: "a" }]);
      writeTestLog("server.2026-05-02.log", [{ time: 2, level: 30, msg: "b" }]);

      const files = await service.listFiles();
      expect(files).toHaveLength(2);
      expect(files[0].name).toBe("server.2026-05-02.log");
      expect(files[1].name).toBe("server.2026-05-01.log");
      expect(files[0]).toHaveProperty("size");
      expect(files[0]).toHaveProperty("modifiedAt");
    });

    it("returns empty array when directory is empty", async () => {
      const files = await service.listFiles();
      expect(files).toEqual([]);
    });
  });

  describe("readRecent", () => {
    it("returns last N entries from newest file", async () => {
      const lines = Array.from({ length: 10 }, (_, i) => ({
        time: Date.now() + i,
        level: 30,
        msg: `line-${i}`,
      }));
      writeTestLog("server.2026-05-05.log", lines);

      const entries = await service.readRecent({ limit: 5 });
      expect(entries).toHaveLength(5);
      expect(entries[0].msg).toBe("line-9");
      expect(entries[4].msg).toBe("line-5");
    });

    it("filters by level", async () => {
      writeTestLog("server.2026-05-05.log", [
        { time: 1, level: 30, msg: "info" },
        { time: 2, level: 50, msg: "error" },
        { time: 3, level: 40, msg: "warn" },
      ]);

      const entries = await service.readRecent({ level: "error" });
      expect(entries).toHaveLength(1);
      expect(entries[0].msg).toBe("error");
    });
  });

  describe("streamZipTo", () => {
    it("streams a zip archive with matching files", async () => {
      writeTestLog("server.2026-05-01.log", [{ time: 1, level: 30, msg: "a" }]);
      writeTestLog("server.2026-05-03.log", [{ time: 2, level: 30, msg: "b" }]);

      const result = await service.streamZipTo(createWritable(), { from: "2026-05-01", to: "2026-05-03" });
      expect(result.bytes).toBeGreaterThan(0);
      expect(result.fileCount).toBe(2);
    });

    it("includes all files when no date range specified", async () => {
      writeTestLog("server.2026-05-01.log", [{ time: 1, level: 30, msg: "a" }]);
      writeTestLog("server.2026-05-02.log", [{ time: 2, level: 30, msg: "b" }]);

      const result = await service.streamZipTo(createWritable(), {});
      expect(result.bytes).toBeGreaterThan(0);
      expect(result.fileCount).toBe(2);
    });
  });

  describe("cleanup", () => {
    it("removes files older than specified date", async () => {
      writeTestLog("server.2026-04-01.log", [{ time: 1, level: 30, msg: "old" }]);
      writeTestLog("server.2026-05-05.log", [{ time: 2, level: 30, msg: "new" }]);

      const deleted = await service.cleanup("2026-05-01");
      expect(deleted).toBe(1);
      expect(existsSync(join(TEST_LOG_DIR, "server.2026-04-01.log"))).toBe(false);
      expect(existsSync(join(TEST_LOG_DIR, "server.2026-05-05.log"))).toBe(true);
    });
  });
});

function createWritable(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}
