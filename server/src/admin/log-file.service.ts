import { Injectable } from "@nestjs/common";
import { readdir, stat, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import archiver from "archiver";

const PINO_LEVELS: Record<string, number> = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

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

  constructor(logDir?: string) {
    this.logDir = logDir ?? join(process.cwd(), "logs");
  }

  async listFiles(): Promise<LogFileInfo[]> {
    const entries = await readdir(this.logDir).catch(() => []);
    const files: LogFileInfo[] = [];

    for (const name of entries) {
      if (!name.endsWith(".log")) continue;
      const fileStat = await stat(join(this.logDir, name));
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

      const content = await readFile(join(this.logDir, file.name), "utf-8");
      const lines = content.trim().split("\n").reverse();

      for (const line of lines) {
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
}
