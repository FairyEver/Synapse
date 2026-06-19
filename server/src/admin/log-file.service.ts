import { Inject, Injectable, Optional } from "@nestjs/common";
import { createReadStream } from "node:fs";
import type { Stats } from "node:fs";
import { lstat, open, readdir, realpath, unlink } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { Transform, type TransformCallback, type Writable } from "node:stream";
import archiver from "archiver";
import { redactSensitiveLogText } from "../common/audit-error";

export const LOG_DIR_TOKEN = "LOG_DIR";

const PINO_LEVELS: Record<string, number> = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};
const RECENT_LOG_CHUNK_SIZE_BYTES = 64 * 1024;

export interface LogFileInfo {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface LogEntry {
  time: string;
  level: string;
  msg: string;
  req?: { method: string; url: string };
  err?: { message: string; stack: string };
}

export interface LogZipStreamResult {
  bytes: number;
  fileCount: number;
}

export interface LogCleanupFailure {
  name: string;
  errorName: string;
  errorCode?: string;
}

export interface LogCleanupResult {
  deleted: number;
  failures: LogCleanupFailure[];
}

interface ResolvedLogFile {
  name: string;
  path: string;
  stat: Stats;
}

@Injectable()
export class LogFileService {
  private readonly logDir: string;

  constructor(@Optional() @Inject(LOG_DIR_TOKEN) logDir?: string) {
    this.logDir = logDir ?? join(process.cwd(), "logs");
  }

  async listFiles(): Promise<LogFileInfo[]> {
    let entries: string[];
    try {
      entries = await readdir(this.logDir);
    } catch (error) {
      if (this.isFileNotFoundError(error)) return [];
      throw error;
    }
    const files: LogFileInfo[] = [];

    for (const name of entries) {
      const file = await this.resolveLogFile(name);
      if (!file) continue;
      files.push({
        name: file.name,
        size: file.stat.size,
        modifiedAt: file.stat.mtime.toISOString(),
      });
    }

    return files.sort((a, b) => {
      const timeDiff = new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      // Fall back to filename descending when mtimes are equal
      return b.name.localeCompare(a.name);
    });
  }

  async readRecent(opts: { from?: string; level?: string; limit?: number; to?: string } = {}): Promise<LogEntry[]> {
    const { from, level, limit = 200, to } = opts;
    const files = await this.listFiles();
    if (files.length === 0) return [];

    const targetLevel = level ? PINO_LEVELS[level] : undefined;
    const results: LogEntry[] = [];

    for (const file of files) {
      if (results.length >= limit) break;

      try {
        for await (const line of this.readLinesFromTail(join(this.logDir, file.name), file.size)) {
          if (results.length >= limit) break;
          try {
            const parsed = JSON.parse(line);
            if (targetLevel !== undefined && parsed.level !== targetLevel) continue;
            const entryTime = new Date(parsed.time);
            const entryDate = entryTime.toISOString().slice(0, 10);
            if (from && entryDate < from) continue;
            if (to && entryDate > to) continue;
            results.push({
              time: entryTime.toISOString(),
              level: this.levelToName(parsed.level),
              msg: redactSensitiveLogText(parsed.msg ?? parsed.message ?? ""),
              ...(parsed.req && {
                req: {
                  method: String(parsed.req.method ?? ""),
                  url: redactSensitiveLogText(parsed.req.url ?? ""),
                },
              }),
              ...(parsed.err && {
                err: {
                  message: redactSensitiveLogText(parsed.err.message ?? ""),
                  stack: redactSensitiveLogText(parsed.err.stack ?? ""),
                },
              }),
            });
          } catch {
            // skip malformed lines
          }
        }
      } catch (error) {
        if (this.isFileNotFoundError(error)) continue;
        throw error;
      }
    }

    return results;
  }

  async streamZipTo(output: Writable, opts: { from?: string; to?: string } = {}): Promise<LogZipStreamResult> {
    const filtered = await this.listDownloadFiles(opts);
    const archiveEntries: Array<{ name: string; path: string }> = [];
    for (const file of filtered) {
      const resolved = await this.resolveLogFile(file.name);
      if (resolved) archiveEntries.push({ name: file.name, path: resolved.path });
    }

    return new Promise((resolve, reject) => {
      const archive = archiver("zip", { zlib: { level: 6 } });

      archive.on("error", reject);
      output.on("error", reject);
      archive.on("end", () => resolve({ bytes: archive.pointer(), fileCount: archiveEntries.length }));
      archive.pipe(output);

      for (const file of archiveEntries) {
        archive.append(this.createRedactedLogStream(file.path), { name: file.name });
      }

      archive.finalize();
    });
  }

  private createRedactedLogStream(filePath: string): Transform {
    let pending = "";
    const source = createReadStream(filePath, { encoding: "utf8" });
    const redactor = new Transform({
      transform(chunk: Buffer | string, _encoding: BufferEncoding, callback: TransformCallback) {
        const text = pending + chunk.toString();
        const lines = text.split(/\r?\n/);
        pending = lines.pop() ?? "";
        if (lines.length > 0) {
          this.push(lines.map((line) => redactSensitiveLogText(line)).join("\n") + "\n");
        }
        callback();
      },
      flush(callback: TransformCallback) {
        if (pending) this.push(redactSensitiveLogText(pending));
        callback();
      },
    });

    source.on("error", (error) => redactor.destroy(error));
    return source.pipe(redactor);
  }

  private async listDownloadFiles(opts: { from?: string; to?: string } = {}): Promise<LogFileInfo[]> {
    const { from, to } = opts;
    const files = await this.listFiles();

    return files.filter((file) => {
      const fileDate = this.getDownloadFileDate(file);
      if (from && fileDate < from) return false;
      if (to && fileDate > to) return false;
      return true;
    });
  }

  private getDownloadFileDate(file: LogFileInfo): string {
    const dateMatch = file.name.match(/(\d{4}-\d{2}-\d{2})/);
    return dateMatch?.[1] ?? file.modifiedAt.slice(0, 10);
  }

  async cleanup(before: string): Promise<LogCleanupResult> {
    const files = await this.listFiles();
    let deleted = 0;
    const failures: LogCleanupFailure[] = [];

    for (const file of files) {
      const dateMatch = file.name.match(/(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) continue;
      if (dateMatch[1] < before) {
        try {
          await unlink(join(this.logDir, file.name));
          deleted++;
        } catch (error) {
          if (this.isFileNotFoundError(error)) {
            deleted++;
            continue;
          }
          failures.push(this.cleanupFailure(file.name, error));
        }
      }
    }

    return { deleted, failures };
  }

  private levelToName(level: number): string {
    if (level <= 20) return "debug";
    if (level <= 30) return "info";
    if (level <= 40) return "warn";
    if (level <= 50) return "error";
    return "fatal";
  }

  private isFileNotFoundError(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  }

  private async resolveLogFile(name: string): Promise<ResolvedLogFile | null> {
    if (!name.endsWith(".log") || basename(name) !== name) return null;

    const path = join(this.logDir, name);
    try {
      const fileStat = await lstat(path);
      if (!fileStat.isFile()) return null;

      const [resolvedLogDir, resolvedPath] = await Promise.all([
        realpath(this.logDir),
        realpath(path),
      ]);
      if (!this.isPathInside(resolvedLogDir, resolvedPath)) return null;

      return { name, path: resolvedPath, stat: fileStat };
    } catch (error) {
      if (this.isFileNotFoundError(error)) return null;
      throw error;
    }
  }

  private isPathInside(parentPath: string, childPath: string): boolean {
    const relativePath = relative(parentPath, childPath);
    return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
  }

  private cleanupFailure(name: string, error: unknown): LogCleanupFailure {
    return {
      name,
      errorName: error instanceof Error ? error.name : typeof error,
      ...(
        error instanceof Error && "code" in error && typeof error.code === "string"
          ? { errorCode: error.code }
          : {}
      ),
    };
  }

  private async *readLinesFromTail(filePath: string, fileSize: number): AsyncGenerator<string> {
    if (fileSize <= 0) return;

    const handle = await open(filePath, "r");
    try {
      let position = fileSize;
      let prefix: Buffer<ArrayBufferLike> = Buffer.alloc(0);

      while (position > 0) {
        const readLength = Math.min(RECENT_LOG_CHUNK_SIZE_BYTES, position);
        position -= readLength;

        const buffer = Buffer.allocUnsafe(readLength);
        const { bytesRead } = await handle.read(buffer, 0, readLength, position);
        if (bytesRead === 0) break;

        const parts = this.splitByNewline(Buffer.concat([buffer.subarray(0, bytesRead), prefix]));
        prefix = parts.shift() ?? Buffer.alloc(0);

        for (let index = parts.length - 1; index >= 0; index--) {
          const line = parts[index].toString("utf8").trim();
          if (line) yield line;
        }
      }

      const firstLine = prefix.toString("utf8").trim();
      if (firstLine) yield firstLine;
    } finally {
      await handle.close();
    }
  }

  private splitByNewline(buffer: Buffer): Buffer[] {
    const parts: Buffer[] = [];
    let start = 0;
    for (let index = 0; index < buffer.length; index++) {
      if (buffer[index] !== 10) continue;
      parts.push(buffer.subarray(start, index));
      start = index + 1;
    }
    parts.push(buffer.subarray(start));
    return parts;
  }
}
