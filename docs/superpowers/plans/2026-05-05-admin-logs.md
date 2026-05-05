# 后台管理日志功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员在后台面板中查看服务器最近日志并按日期范围下载日志文件。

**Architecture:** pino-roll transport 将日志写入按天轮转的文件，NestJS 新增 LogFileService 提供文件扫描/读取/打包能力，AdminController 暴露 4 个端点，前端新增日志页面。

**Tech Stack:** pino-roll, archiver, NestJS, React, shadcn/ui

---

## File Structure

| 操作 | 文件路径 | 职责 |
|------|----------|------|
| Create | `server/src/admin/log-file.service.ts` | 日志文件扫描、读取尾部、ZIP 打包、清理 |
| Create | `server/src/admin/log-file.controller.ts` | 日志相关 API 端点 |
| Modify | `server/src/admin/admin.module.ts` | 注册 LogFileService + LogFileController |
| Modify | `server/src/app.module.ts` | 添加 pino-roll transport 配置 |
| Create | `server/admin/src/pages/logs-page.tsx` | 日志查看与下载页面 |
| Modify | `server/admin/src/lib/api.ts` | 新增日志相关 API 方法 |
| Modify | `server/admin/src/App.tsx` | 添加 logs 路由 |
| Modify | `server/admin/src/components/app-sidebar.tsx` | 侧栏添加"系统日志"导航项 |
| Create | `server/test/log-file.service.spec.ts` | LogFileService 单元测试 |
| Create | `server/test/log-file.controller.spec.ts` | LogFileController 集成测试 |

---

### Task 1: 安装依赖

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: 安装 pino-roll 和 archiver**

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
pnpm add pino-roll archiver
pnpm add -D @types/archiver
```

- [ ] **Step 2: 验证安装**

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
node -e "require('pino-roll'); require('archiver'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add server/package.json server/pnpm-lock.yaml
git commit -m "feat(server): add pino-roll and archiver dependencies"
```

---

### Task 2: 配置 pino-roll transport

**Files:**
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: 修改 LoggerModule 配置，添加文件 transport**

将现有的 `pinoHttp.transport` 改为多目标模式：

```typescript
import { join } from "node:path";

// 在 LoggerModule.forRoot 中：
pinoHttp: {
  autoLogging: true,
  redact: ["req.headers.cookie", "req.headers.authorization"],
  transport: {
    targets: [
      ...(process.env.NODE_ENV !== "production"
        ? [{ target: "pino-pretty", level: "info" as const, options: { colorize: true } }]
        : []),
      {
        target: "pino-roll",
        level: "debug" as const,
        options: {
          file: join(process.cwd(), "logs", "server"),
          frequency: "daily",
          size: "50m",
          extension: ".log",
          limit: { count: 30 },
          mkdir: true,
        },
      },
    ],
  },
},
```

- [ ] **Step 2: 启动服务验证日志文件生成**

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
pnpm dev &
sleep 3
ls logs/
kill %1
```

Expected: `logs/` 目录下出现 `server.1.log` 或类似文件（pino-roll 按 daily 命名）

- [ ] **Step 3: Commit**

```bash
git add server/src/app.module.ts
git commit -m "feat(server): configure pino-roll file transport with daily rotation"
```

---

### Task 3: 实现 LogFileService

**Files:**
- Create: `server/src/admin/log-file.service.ts`
- Create: `server/test/log-file.service.spec.ts`

- [ ] **Step 1: 写 LogFileService 的测试**

```typescript
// server/test/log-file.service.spec.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
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

  describe("downloadAsZip", () => {
    it("creates a zip buffer with matching files", async () => {
      writeTestLog("server.2026-05-01.log", [{ time: 1, level: 30, msg: "a" }]);
      writeTestLog("server.2026-05-03.log", [{ time: 2, level: 30, msg: "b" }]);

      const buffer = await service.downloadAsZip({ from: "2026-05-01", to: "2026-05-03" });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it("includes all files when no date range specified", async () => {
      writeTestLog("server.2026-05-01.log", [{ time: 1, level: 30, msg: "a" }]);
      writeTestLog("server.2026-05-02.log", [{ time: 2, level: 30, msg: "b" }]);

      const buffer = await service.downloadAsZip({});
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
pnpm vitest run test/log-file.service.spec.ts
```

Expected: FAIL — `Cannot find module '../src/admin/log-file.service'`

- [ ] **Step 3: 实现 LogFileService**

```typescript
// server/src/admin/log-file.service.ts
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

    return files.sort(
      (a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime(),
    );
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
pnpm vitest run test/log-file.service.spec.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/admin/log-file.service.ts server/test/log-file.service.spec.ts
git commit -m "feat(server): implement LogFileService with tests"
```

---

### Task 4: 实现 LogFileController

**Files:**
- Create: `server/src/admin/log-file.controller.ts`
- Create: `server/test/log-file.controller.spec.ts`
- Modify: `server/src/admin/admin.module.ts`

- [ ] **Step 1: 写 Controller 测试**

```typescript
// server/test/log-file.controller.spec.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { LogFileController } from "../src/admin/log-file.controller";
import { LogFileService } from "../src/admin/log-file.service";

const TEST_LOG_DIR = join(process.cwd(), "test-logs-ctrl");

describe("LogFileController", () => {
  let app: INestApplication;

  beforeAll(async () => {
    mkdirSync(TEST_LOG_DIR, { recursive: true });
    writeFileSync(
      join(TEST_LOG_DIR, "server.2026-05-05.log"),
      [
        JSON.stringify({ time: Date.now(), level: 30, msg: "hello" }),
        JSON.stringify({ time: Date.now(), level: 50, msg: "oops" }),
      ].join("\n") + "\n",
    );

    const module = await Test.createTestingModule({
      controllers: [LogFileController],
      providers: [
        { provide: LogFileService, useValue: new LogFileService(TEST_LOG_DIR) },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_LOG_DIR, { recursive: true, force: true });
  });

  it("GET /admin/api/logs/files returns file list", async () => {
    const res = await request(app.getHttpServer()).get("/admin/api/logs/files");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("server.2026-05-05.log");
  });

  it("GET /admin/api/logs/recent returns entries", async () => {
    const res = await request(app.getHttpServer()).get("/admin/api/logs/recent?limit=10");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("GET /admin/api/logs/recent?level=error filters by level", async () => {
    const res = await request(app.getHttpServer()).get("/admin/api/logs/recent?level=error");
    expect(res.status).toBe(200);
    expect(res.body.every((e: { level: string }) => e.level === "error")).toBe(true);
  });

  it("GET /admin/api/logs/download returns zip", async () => {
    const res = await request(app.getHttpServer()).get("/admin/api/logs/download");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
pnpm vitest run test/log-file.controller.spec.ts
```

Expected: FAIL — `Cannot find module '../src/admin/log-file.controller'`

- [ ] **Step 3: 实现 LogFileController**

```typescript
// server/src/admin/log-file.controller.ts
import { Controller, Get, Delete, Query, Res, UseGuards, BadRequestException } from "@nestjs/common";
import { Response } from "express";
import { LogFileService } from "./log-file.service";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard";

@Controller("/admin/api/logs")
@UseGuards(AdminAuthGuard)
export class LogFileController {
  constructor(private readonly logFileService: LogFileService) {}

  @Get("files")
  async listFiles() {
    return this.logFileService.listFiles();
  }

  @Get("recent")
  async getRecent(
    @Query("level") level?: string,
    @Query("limit") limitStr?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 200;
    if (level && !["debug", "info", "warn", "error", "fatal"].includes(level)) {
      throw new BadRequestException(`Invalid level: ${level}`);
    }
    return this.logFileService.readRecent({ level, limit });
  }

  @Get("download")
  async download(
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @Res() res: Response,
  ) {
    const buffer = await this.logFileService.downloadAsZip({ from, to });
    const filename = from || to
      ? `logs-${from ?? "start"}-${to ?? "now"}.zip`
      : "logs-all.zip";

    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length.toString(),
    });
    res.send(buffer);
  }

  @Delete("cleanup")
  async cleanup(@Query("before") before?: string) {
    if (!before || !/^\d{4}-\d{2}-\d{2}$/.test(before)) {
      throw new BadRequestException("Query param 'before' must be YYYY-MM-DD format");
    }
    const deleted = await this.logFileService.cleanup(before);
    return { deleted };
  }
}
```

- [ ] **Step 4: 注册到 AdminModule**

在 `server/src/admin/admin.module.ts` 中添加：

```typescript
import { LogFileService } from "./log-file.service";
import { LogFileController } from "./log-file.controller";

@Module({
  controllers: [AdminController, LogFileController],
  providers: [AdminService, AuditLogService, LogFileService],
})
export class AdminModule {}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
pnpm vitest run test/log-file.controller.spec.ts
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/admin/log-file.controller.ts server/src/admin/admin.module.ts server/test/log-file.controller.spec.ts
git commit -m "feat(server): add LogFileController with admin API endpoints"
```

---

### Task 5: 前端 API 客户端方法

**Files:**
- Modify: `server/admin/src/lib/api.ts`

- [ ] **Step 1: 添加日志相关类型和方法**

在 `api.ts` 末尾的 `adminApi` 对象中添加：

```typescript
// 类型定义（文件顶部 types 区域）
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

// adminApi 对象中添加方法
async listLogFiles(): Promise<LogFileInfo[]> {
  return request<LogFileInfo[]>("/admin/api/logs/files");
},

async fetchRecentLogs(opts?: { level?: string; limit?: number }): Promise<LogEntry[]> {
  const params = new URLSearchParams();
  if (opts?.level) params.set("level", opts.level);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return request<LogEntry[]>(`/admin/api/logs/recent${qs ? `?${qs}` : ""}`);
},

downloadLogs(opts?: { from?: string; to?: string }) {
  const params = new URLSearchParams();
  if (opts?.from) params.set("from", opts.from);
  if (opts?.to) params.set("to", opts.to);
  const qs = params.toString();
  window.open(`/admin/api/logs/download${qs ? `?${qs}` : ""}`, "_blank");
},
```

- [ ] **Step 2: 验证类型检查通过**

```bash
cd /Users/liyang/Documents/code/github/Synapse/server/admin
npx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add server/admin/src/lib/api.ts
git commit -m "feat(admin): add log API client methods"
```

---

### Task 6: 前端日志页面

**Files:**
- Create: `server/admin/src/pages/logs-page.tsx`
- Modify: `server/admin/src/App.tsx`
- Modify: `server/admin/src/components/app-sidebar.tsx`

- [ ] **Step 1: 创建日志页面组件**

```tsx
// server/admin/src/pages/logs-page.tsx
import { useEffect, useState } from "react";
import { adminApi, type LogEntry, type LogFileInfo } from "../lib/api";
import { PageState } from "../components/page-state";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";

const LEVEL_COLORS: Record<string, string> = {
  error: "destructive",
  warn: "warning",
  info: "default",
  debug: "secondary",
  fatal: "destructive",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [level, setLevel] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [logEntries, logFiles] = await Promise.all([
        adminApi.fetchRecentLogs({
          level: level === "all" ? undefined : level,
          limit: 200,
        }),
        adminApi.listLogFiles(),
      ]);
      setEntries(logEntries);
      setFiles(logFiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [level]);

  if (error) return <PageState type="error" message={error} />;

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">最近日志</h2>
          <div className="flex items-center gap-2">
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="warn">Warn</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={fetchData}>
              刷新
            </Button>
          </div>
        </div>

        {loading ? (
          <PageState type="loading" />
        ) : (
          <div className="border rounded-md max-h-[400px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">时间</TableHead>
                  <TableHead className="w-20">级别</TableHead>
                  <TableHead>消息</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">
                      {new Date(entry.time).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={LEVEL_COLORS[entry.level] as any}>
                        {entry.level}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs truncate max-w-md">
                      {entry.req ? `${entry.req.method} ${entry.req.url} — ` : ""}
                      {entry.msg}
                    </TableCell>
                  </TableRow>
                ))}
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      暂无日志
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">日志文件</h2>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-36"
              placeholder="起始日期"
            />
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-36"
              placeholder="结束日期"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => adminApi.downloadLogs({ from: from || undefined, to: to || undefined })}
              disabled={!from && !to}
            >
              按范围下载
            </Button>
            <Button size="sm" onClick={() => adminApi.downloadLogs()}>
              下载全部
            </Button>
          </div>
        </div>

        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>文件名</TableHead>
                <TableHead className="w-24">大小</TableHead>
                <TableHead className="w-44">修改时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.name}>
                  <TableCell className="font-mono text-sm">{file.name}</TableCell>
                  <TableCell>{formatBytes(file.size)}</TableCell>
                  <TableCell className="text-xs">
                    {new Date(file.modifiedAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
              {files.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    暂无日志文件
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: 在 App.tsx 中添加路由**

在 Route 类型联合中添加 `| { name: "logs" }`，在 hash 解析逻辑中添加：

```typescript
case "#/logs":
  return { name: "logs" };
```

在页面渲染区域添加：

```tsx
{route.name === "logs" && <LogsPage />}
```

- [ ] **Step 3: 在侧栏添加导航项**

在 `app-sidebar.tsx` 的导航配置中添加：

```typescript
{ title: "系统日志", url: "#/logs", icon: FileText }
```

（从 lucide-react 导入 `FileText` 图标）

- [ ] **Step 4: 验证类型检查通过**

```bash
cd /Users/liyang/Documents/code/github/Synapse/server/admin
npx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add server/admin/src/pages/logs-page.tsx server/admin/src/App.tsx server/admin/src/components/app-sidebar.tsx
git commit -m "feat(admin): add system logs page with view and download"
```

---

### Task 7: 端到端验证

- [ ] **Step 1: 启动完整服务**

```bash
cd /Users/liyang/Documents/code/github/Synapse
pnpm dev
```

- [ ] **Step 2: 触发一些请求生成日志**

访问管理面板，执行几个操作（查看激活码列表等），确保日志文件产生。

- [ ] **Step 3: 验证日志页面功能**

1. 访问 `#/logs` 页面
2. 确认最近日志表格有数据
3. 切换级别筛选，确认过滤生效
4. 点击"下载全部"，确认 ZIP 文件下载
5. 选择日期范围，点击"按范围下载"

- [ ] **Step 4: 运行全部测试**

```bash
cd /Users/liyang/Documents/code/github/Synapse/server
pnpm vitest run
```

Expected: All tests PASS

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(server): address issues found during e2e verification"
```
