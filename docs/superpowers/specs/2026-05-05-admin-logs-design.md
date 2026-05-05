# 后台管理日志功能设计

## 概述

为 Synapse 后台管理面板增加完善的服务器日志记录与下载功能。管理员可在面板中查看最近日志条目、按日期范围下载日志文件。

## 范围

- 服务器应用运行日志（请求、错误、启动/停止等）
- 审计日志保持现有实现不变
- 不涉及桌面客户端日志上报

## 1. 日志写入层

### 技术选型

使用 `pino-roll` 作为 pino transport，与现有 `nestjs-pino` 无缝集成。

### 配置

- 文件路径：`logs/server-YYYY-MM-DD.log`（相对于 server 工作目录）
- 轮转规则：按天轮转，单日文件超过 50MB 时拆分（`server-2026-05-05.1.log`）
- 保留策略：保留最近 30 天，超期文件自动删除
- 格式：JSON（每行一条，pino 默认格式）
- 双写：stdout 保持不变（开发 pretty、生产 JSON），文件 transport 并行写入

### 集成方式

在 `app.module.ts` 的 LoggerModule 配置中添加 pino-roll transport：

```typescript
transport: {
  targets: [
    // 现有 stdout transport
    { target: 'pino-pretty', level: 'info', options: { ... } },
    // 新增文件 transport
    {
      target: 'pino-roll',
      level: 'debug',
      options: {
        file: 'logs/server',
        frequency: 'daily',
        size: '50m',
        dateFormat: 'YYYY-MM-DD',
        extension: '.log',
        limit: { count: 30 },
      },
    },
  ],
}
```

## 2. 后端 API

### LogFileService

新建 `server/src/admin/log-file.service.ts`，职责：

- `listFiles()`: 扫描日志目录，返回文件列表（名称、大小、修改时间），按时间倒序
- `readRecent(level?, limit?)`: 读取最新日志文件尾部，解析 JSON 行，按级别过滤，返回最近 N 条
- `downloadAsZip(from?, to?)`: 按日期范围筛选文件，流式打包为 ZIP
- `cleanup(before)`: 删除指定日期之前的日志文件

### API 端点

在 `admin.controller.ts` 中新增，受 `AdminAuthGuard` 保护：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/admin/api/logs/files` | 返回日志文件列表 |
| GET | `/admin/api/logs/recent?level=error&limit=200` | 最近日志条目，支持级别过滤 |
| GET | `/admin/api/logs/download?from=2026-05-01&to=2026-05-05` | ZIP 下载，不传参下载全部 |
| DELETE | `/admin/api/logs/cleanup?before=2026-04-01` | 清理指定日期前的文件 |

### 响应格式

```typescript
// GET /admin/api/logs/files
interface LogFileInfo {
  name: string;
  size: number;       // bytes
  modifiedAt: string; // ISO 8601
}

// GET /admin/api/logs/recent
interface LogEntry {
  time: string;       // ISO 8601
  level: string;      // debug | info | warn | error | fatal
  msg: string;
  req?: { method: string; url: string };
  err?: { message: string; stack: string };
}
```

## 3. 前端管理面板

### 路由

`#/logs` — 侧栏新增"系统日志"导航项。

### 页面布局

**上半部分 — 实时日志查看**

- 表格显示最近 200 条日志：时间、级别（Badge）、消息
- 级别筛选下拉框：全部 / error / warn / info / debug
- 级别颜色：error 红、warn 黄、info 蓝、debug 灰
- 手动刷新按钮

**下半部分 — 日志文件下载**

- 文件列表表格：文件名、大小（人类可读）、日期
- "下载全部"按钮：打包所有文件为 ZIP
- 日期范围选择器 + "按范围下载"按钮
- 单个文件可点击下载

### 新增文件

- `server/admin/src/pages/logs-page.tsx` — 日志页面
- `server/admin/src/lib/api.ts` — 新增 `listLogFiles()`、`fetchRecentLogs()`、`downloadLogs()` 方法

## 4. 错误处理

- 日志目录不存在：服务启动时自动创建，API 返回空列表
- 文件读取中轮转：读取 recent 时对当前文件使用共享锁
- ZIP 大文件：使用 archiver 流式压缩，不加载全部内容到内存
- 磁盘空间：pino-roll 的 limit 配置自动清理，DELETE 端点作为手动兜底
- 权限控制：所有端点走现有 AdminAuthGuard

## 5. 依赖

| 包 | 用途 | 位置 |
|---|------|------|
| pino-roll | 日志文件轮转 transport | server |
| archiver | ZIP 流式打包 | server |

## 6. 不在范围内

- 桌面客户端日志上报
- 日志全文搜索
- 实时 WebSocket 推送
- 日志告警/通知
