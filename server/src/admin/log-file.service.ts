import { Inject, Injectable, Optional } from "@nestjs/common";
import { open, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import archiver from "archiver";

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

@Injectable()
export class LogFileService {
  private readonly logDir: string;

  constructor(@Optional() @Inject(LOG_DIR_TOKEN) logDir?: string) {
    this.logDir = logDir ?? join(process.cwd(), "logs");
  }

  async listFiles(): Promise<LogFileInfo[]> {
    const entries = await readdir(this.logDir).catch(() => []);
    const files: LogFileInfo[] = [];

    for (const name of entries) {
      if (!name.endsWith(".log")) continue;
      let fileStat: Awaited<ReturnType<typeof stat>>;
      try {
        fileStat = await stat(join(this.logDir, name));
      } catch (error) {
        if (this.isFileNotFoundError(error)) continue;
        throw error;
      }
      files.push({
        name,
        size: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
      });
    }

    return files.sort((a, b) => {
      const timeDiff = new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      // Fall back to filename descending when mtimes are equal
      return b.name.localeCompare(a.name);
    });
  }

  async readRecent(opts: { level?: string; limit?: number } = {}): Promise<LogEntry[]> {
    const { level, limit = 200 } = opts;
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
            results.push({
              time: new Date(parsed.time).toISOString(),
              level: this.levelToName(parsed.level),
              msg: parsed.msg ?? parsed.message ?? "",
              ...(parsed.req && { req: { method: parsed.req.method, url: parsed.req.url } }),
              ...(parsed.err && { err: { message: parsed.err.message, stack: parsed.err.stack } }),
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

  async downloadAsZip(opts: { from?: string; to?: string } = {}): Promise<Buffer> {
    const { from, to } = opts;
    const files = await this.listFiles();

    const filtered = files.filter((f) => {
      const dateMatch = f.name.match(/(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) return !from && !to;
      const fileDate = dateMatch[1];
      if (from && fileDate < from) return false;
      if (to && fileDate > to) return false;
      return true;
    });

    return new Promise((resolve, reject) => {
      const archive = archiver("zip", { zlib: { level: 6 } });
      const chunks: Buffer[] = [];

      archive.on("data", (chunk: Buffer) => chunks.push(chunk));
      archive.on("end", () => resolve(Buffer.concat(chunks)));
      archive.on("error", reject);

      for (const file of filtered) {
        archive.file(join(this.logDir, file.name), { name: file.name });
      }

      archive.finalize();
    });
  }

  async cleanup(before: string): Promise<number> {
    const files = await this.listFiles();
    let deleted = 0;

    for (const file of files) {
      const dateMatch = file.name.match(/(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) continue;
      if (dateMatch[1] < before) {
        await unlink(join(this.logDir, file.name));
        deleted++;
      }
    }

    return deleted;
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

  private async *readLinesFromTail(filePath: string, fileSize: number): AsyncGenerator<string> {
    if (fileSize <= 0) return;

    const handle = await open(filePath, "r");
    try {
      let position = fileSize;
      let prefix = Buffer.alloc(0);

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
