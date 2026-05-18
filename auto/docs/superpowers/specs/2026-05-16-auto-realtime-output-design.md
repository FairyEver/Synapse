# auto 实时输出流设计

> 日期：2026-05-16
> 状态：spec

## 背景

`auto` 是本地 Codex / Claude Code 并行运行控制台。当前 Web UI 只在运行视图中显示 worker 卡片，每张卡片仅展示 `lastMessage`（最后一行输出）、耗时和退出码。Worker 的完整输出仅写入 `logs/` 文件，Web UI 无法实时观察。

本次改造目标：让用户在浏览器中实时看到每个 worker 的完整终端输出流。

## 决策记录

| 决策 | 选项 | 结论 |
|---|---|---|
| 可观测性方向 | 实时进度 / 日志回溯 / 统计分析 | **实时进度与结果展示** |
| 信息粒度 | 实时输出流 / 结构化时间线 / 增强卡片 | **Worker 实时输出流** |
| 前端技术栈 | 纯 HTML+JS / 轻量 CDN 库 / 全框架重写 | **Vite + React + shadcn/ui** |
| 展示形式 | 终端风格 / 消息流 / 分栏并排 | **终端风格（可折叠面板）** |
| Server→Client 传输 | 扩展 SSE / WebSocket / REST 轮询 | **扩展现有 SSE** |

## 范围

### 做

- 服务端：runner 输出广播 + SSE 多事件类型 + 输出缓冲
- 前端：Vite + React + shadcn 重写全部 Web UI
- 运行视图：终端风格 worker 面板，实时滚动输出
- 配置视图：1:1 功能迁移，shadcn 组件替换

### 不做

- JSON 事件的结构化/语义化渲染（终端直接显示原始文本）
- 终端 ANSI 颜色解析
- 输出搜索/过滤
- 历史批次日志浏览
- Token 统计
- 输出持久化查询（历史批次仍看文件）
- SSR / 路由 / 状态管理库

---

## 一、服务端：输出广播机制

### 1.1 新增类型

```typescript
// runner.ts
export type OutputLine = {
  workerId: number
  stream: 'stdout' | 'stderr' | 'event'
  text: string
  ts: number // Date.now()
}

export type WorkerOutputCallback = (line: OutputLine) => void
```

### 1.2 runner.ts 变更

`runWorker` 签名新增 `onOutput?: WorkerOutputCallback` 参数。

在 `child.stdout.on('data')` 逐行处理中：
- 非 JSON 行 → `onOutput({ workerId, stream: 'stdout', text: line, ts })`
- 成功解析为 JSON 的行 → `onOutput({ workerId, stream: 'event', text: rawLine, ts })`

在 `child.stderr.on('data')` 中：
- 每行 → `onOutput({ workerId, stream: 'stderr', text: line, ts })`

`runBatch` 签名新增 `onOutput?: WorkerOutputCallback`，透传给每个 `runWorker`。

现有 `onUpdate` 回调和日志写入逻辑不变。

### 1.3 AutoScheduler 变更

`BatchRunner` 类型扩展：

```typescript
export type BatchRunner = (
  config: UiConfig,
  onUpdate?: (snapshot: BatchSnapshot) => void,
  onOutput?: WorkerOutputCallback
) => Promise<BatchResult>
```

`AutoScheduler` 新增：
- `outputListeners: Set<WorkerOutputCallback>` — 输出事件订阅集合
- `subscribeOutput(cb): () => void` — 订阅/取消方法
- 在 `loop()` 调用 `batchRunner` 时传入 `onOutput`，将每行广播给 `outputListeners`

### 1.4 server.ts SSE 多事件类型

当前 `/events` 端点只发无名 SSE 事件。改为命名事件：

```
event: snapshot
data: {"status":"running","currentBatch":{...},...}

event: output
data: {"workerId":1,"stream":"stdout","text":"正在分析...","ts":1747368000000}
```

实现：
- scheduler snapshot 监听器发 `event: snapshot`
- scheduler output 监听器发 `event: output`
- 连接关闭时取消两个订阅

### 1.5 输出缓冲 + REST 端点

`server.ts` 维护一个 `OutputBuffer`：

```typescript
class OutputBuffer {
  private lines: Map<number, OutputLine[]> = new Map()
  private maxPerWorker = 2000

  append(line: OutputLine): void { /* 追加，超限从头裁剪 */ }
  reset(): void { /* 新批次时清空 */ }
  getAll(): Record<number, OutputLine[]> { /* 返回所有 worker 缓冲 */ }
}
```

新增 REST 端点：

```
GET /api/workers/output
→ { workers: { [workerId]: OutputLine[] } }
```

返回当前 batch 的缓冲内容，供中途打开页面的客户端拉取历史。

缓冲由 scheduler 的 snapshot 监听器在检测到新 batch（`currentBatch.id` 变化）时调用 `reset()`。

### 1.6 静态文件服务变更

`server.ts` 的静态文件服务路径从 `src/web/` 改为 `dist/web/`（Vite 构建产物目录）。

开发模式下，`server.ts` 不 serve 静态文件，前端由 `vite dev` 独立服务，通过 Vite proxy 转发 API 和 SSE 请求到 auto server。

---

## 二、前端：Vite + React + shadcn 重写

### 2.1 项目结构

```
auto/
  web/                          ← 新增前端项目
    src/
      components/
        layout/
          app-shell.tsx         ← 顶层 Tabs 布局
          config-view.tsx       ← 配置页
          run-view.tsx          ← 运行页
        workers/
          worker-panel.tsx      ← 单个 worker 可折叠终端面板
          worker-grid.tsx       ← worker 面板容器
          terminal.tsx          ← 终端输出渲染
        config/
          prompt-editor.tsx     ← 提示词编辑器
          provider-settings.tsx ← Codex / Claude Code 设置
          run-params.tsx        ← 运行参数表单
        ui/                     ← shadcn 组件
      hooks/
        use-sse.ts              ← SSE 连接 + 事件分发
        use-output-buffer.ts    ← 按 workerId 累积输出行
        use-config.ts           ← 配置 CRUD
      lib/
        api.ts                  ← fetch 封装
        types.ts                ← 共享类型
      app.tsx
      main.tsx
    index.html
    vite.config.ts
    components.json
    tailwind.config.ts
    tsconfig.json
    package.json
```

旧 `src/web/`（index.html、app.js、styles.css）删除。

### 2.2 关键 Hooks

**`use-sse.ts`**

```typescript
function useSSE(): {
  snapshot: SchedulerSnapshot | null
  outputLines: Map<number, OutputLine[]>
  connected: boolean
}
```

- 连接 `/events`
- `event: snapshot` → 更新 snapshot state
- `event: output` → 追加到 outputLines（按 workerId 分桶）
- 断线自动重连（3s 间隔，指数退避上限 30s）
- 新批次检测（snapshot 中 `currentBatch.id` 变化）→ 清空 outputLines

**`use-output-buffer.ts`**

```typescript
function useOutputBuffer(): {
  lines: Map<number, OutputLine[]>
  append(line: OutputLine): void
  reset(): void
}
```

- 每个 workerId 维护行数组，上限 5000 行
- 超限时从头部裁剪，记录裁剪数量
- 页面加载时调 `GET /api/workers/output` 拉取缓冲，再由 SSE 增量补充

**`use-config.ts`**

```typescript
function useConfig(): {
  config: UiConfig | null
  loading: boolean
  error: string
  save(config: UiConfig): Promise<void>
  reload(): Promise<void>
}
```

### 2.3 关键组件

**`terminal.tsx`**

- 等宽字体，深色背景（`bg-zinc-950 text-zinc-100 font-mono text-sm`）
- 每行一个 `<div>`，文本不换行，横向滚动
- 自动滚到底部；用户手动上滚时暂停，底部浮现"回到最新"按钮
- 超过 1000 行时启用虚拟滚动（只渲染可见区域 ± 缓冲区）
- stderr 行用 `text-red-400` 区分
- event 行保持原始 JSON 文本，无特殊格式化

**`worker-panel.tsx`**

- shadcn `Collapsible` 包裹
- 头部区域：
  - Worker 编号（`Worker 1`）
  - 状态 badge（pending / running / success / error / timeout）
  - 实时耗时（running 时持续更新）
  - 展开/折叠 chevron
- 展开内容：`terminal.tsx` 实例
- Worker 完成后，终端底部追加一行状态摘要
- 默认行为：≤3 个 worker 全部展开，>3 个只展开第一个

**`worker-grid.tsx`**

- 垂直堆叠排列（非并排分栏）
- 响应式：窄屏全宽，宽屏有最大宽度限制

**`run-view.tsx`**

- 顶部：批次信息栏
  - 调度器状态 badge
  - 批次 ID / 开始时间 / 耗时
  - Summary 文件路径
  - waiting 状态时显示下一批倒计时
- 中部：`worker-grid`
- 底部固定栏：停止按钮

**`config-view.tsx`**

1:1 迁移现有配置页功能，使用 shadcn 组件：
- `Tabs` → 顶层页面切换
- `Select` → 提示词选择、provider、model
- `Input` → 数值参数
- `Textarea` → 提示词内容
- `Button` → 操作按钮
- `Dialog` → 未保存确认弹窗

### 2.4 构建与集成

| 脚本 | 命令 | 说明 |
|---|---|---|
| `dev:web` | `vite dev` in `web/` | 前端开发服务器，proxy API 到 auto server |
| `build:web` | `vite build` in `web/` | 构建到 `dist/web/` |
| `dev` | 并行启动 `tsx src/index.ts` + `vite dev` | 全栈开发 |
| `start` | `build:web` → `tsx src/index.ts` | 生产模式 |
| `once` | 不变 | 无需前端 |

`vite.config.ts` 关键配置：
- `build.outDir`: `'../dist/web'`
- `server.proxy`: `{ '/api': 'http://127.0.0.1:47831', '/events': { target: 'http://127.0.0.1:47831', ws: false } }`

---

## 三、数据流全景

```
codex/claude CLI stdout/stderr
  → runner.ts: 逐行解析
    ├→ logger.ts: 写入日志文件（不变）
    ├→ onUpdate: WorkerResult（lastMessage、status 等）
    └→ onOutput: OutputLine（完整文本行）
      → AutoScheduler.outputListeners
        → server.ts SSE handler
          → event: output → EventSource
            → use-sse → use-output-buffer → terminal.tsx
```

## 四、交互规则

| 场景 | 行为 |
|---|---|
| 页面加载时批次已在运行 | `GET /api/workers/output` 拉缓冲 → 渲染历史 → SSE 增量接续 |
| 新批次开始 | output buffer 清空 → 终端清屏 |
| Worker 完成 | 面板保持展开，终端底部显示结束状态行 |
| 批次全部完成 | 顶部信息栏更新最终状态，终端内容保持可回看 |
| 调度器 waiting | 显示下一批倒计时，终端保持上一批内容 |
| 输出超 5000 行 | 头部裁剪，终端顶部显示"已裁剪 N 行" |
| 终端自动滚动 | 默认锁底；手动上滚暂停，浮现"回到最新"按钮 |
| 折叠面板 | 输出继续缓冲，展开时立即渲染最新 |
| SSE 断连 | 顶部显示断连提示，3s 后重连，重连后拉取缓冲补齐 |

## 五、新增依赖

### 服务端（auto/）

无新增运行时依赖。

### 前端（auto/web/）

- `react`, `react-dom`
- `tailwindcss`, `@tailwindcss/vite`
- `shadcn` CLI + 所需组件（button, input, select, textarea, tabs, collapsible, badge, dialog）
- `vite`
- `typescript`
- `@tanstack/react-virtual`（虚拟滚动，仅终端组件使用）
