# Token Usage Monitor — 设计规格

> 日期：2026-05-04
> 目标：将 tokscale 的核心功能重写为 Synapse 桌面应用的内置模块，提供 GUI 可视化界面

## 1. 概述

在 Synapse 中新增 "Token Usage" 独立 Tab，自动扫描本机所有 AI 编码 Agent 的日志文件，解析 token 用量数据，以图表和表格形式展示汇总统计。

功能范围对齐 tokscale v2.1.0，覆盖 21 个 Agent，提供 Overview、Models、Daily、Hourly、Stats（贡献图）、Agents 六个视图。

## 2. 数据模型

直接翻译自 tokscale 的 Rust 类型定义。

### 2.1 TokenBreakdown — 五维 token 分类

```typescript
interface TokenBreakdown {
  input: number       // 非缓存输入 token
  output: number      // 输出 token
  cacheRead: number   // 缓存读取 token
  cacheWrite: number  // 缓存写入 token
  reasoning: number   // 推理 token（thinking/reasoning）
}
```

### 2.2 UnifiedMessage — 统一消息

所有 Agent 解析器的标准输出格式。

```typescript
interface UnifiedMessage {
  client: string           // "claude" | "codex" | "cursor" | ... (21 种)
  modelId: string          // "claude-opus-4-6" | "gpt-5.5"
  providerId: string       // "anthropic" | "openai" | "google"
  sessionId: string
  workspaceKey?: string    // 规范化路径
  workspaceLabel?: string  // 路径最后一段
  timestamp: number        // Unix 毫秒
  date: string             // "YYYY-MM-DD" 本地时区
  tokens: TokenBreakdown
  cost: number             // USD
  messageCount: number     // 默认 1
  agent?: string           // 子代理名称
  dedupKey?: string        // 去重键
  isTurnStart: boolean     // 是否为用户 turn 后的首条响应
}
```

### 2.3 聚合输出

```typescript
// 每日贡献（热力图数据源）
interface DailyContribution {
  date: string
  totals: { tokens: number; cost: number; messages: number }
  intensity: 0 | 1 | 2 | 3 | 4
  tokenBreakdown: TokenBreakdown
  clients: ClientContribution[]
}

interface ClientContribution {
  client: string
  modelId: string
  providerId: string
  tokens: TokenBreakdown
  cost: number
  messages: number
}

// 全局汇总
interface DataSummary {
  totalTokens: number
  totalCost: number
  totalDays: number
  activeDays: number
  averagePerDay: number
  maxCostInSingleDay: number
  clients: string[]
  models: string[]
}

// 模型用量
interface ModelUsage {
  client: string
  mergedClients?: string
  workspaceKey?: string
  workspaceLabel?: string
  model: string
  provider: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  messageCount: number
  cost: number
}

// 小时用量
interface HourlyUsage {
  hour: string              // "YYYY-MM-DD HH:00"
  clients: string[]
  models: string[]
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  messageCount: number
  turnCount: number
  cost: number
}

// 最终输出
interface GraphResult {
  meta: { generatedAt: string; processingTimeMs: number }
  summary: DataSummary
  years: { year: string; totalTokens: number; totalCost: number }[]
  contributions: DailyContribution[]
}
```

## 3. Agent 注册表

### 3.1 ClientDef 结构

```typescript
interface ClientDef {
  id: string
  name: string                    // 显示名
  root: "home" | "xdgData" | "config" | "envVar"
  envVar?: string                 // root=envVar 时的环境变量名
  fallbackRelative?: string       // 环境变量未设置时的回退路径
  relativePath: string
  filePattern: string             // glob pattern
  parseLocal: boolean             // 是否本地解析（Cursor 为 false）
}
```

### 3.2 全部 21 个 Agent 定义

直接翻译自 tokscale `clients.rs`：

| # | id | root | envVar | relativePath | filePattern |
|---|-----|------|--------|-------------|-------------|
| 0 | opencode | xdgData | — | opencode/storage/message | *.json |
| 1 | claude | home | — | .claude/projects | *.jsonl |
| 2 | codex | envVar | CODEX_HOME (.codex) | sessions | *.jsonl |
| 3 | cursor | home | — | .config/tokscale/cursor-cache | usage*.csv |
| 4 | gemini | home | — | .gemini/tmp | *.json\|*.jsonl |
| 5 | amp | xdgData | — | amp/threads | T-*.json |
| 6 | droid | home | — | .factory/sessions | *.settings.json |
| 7 | openclaw | home | — | .openclaw/agents | *.jsonl* |
| 8 | pi | home | — | .pi/agent/sessions | *.jsonl |
| 9 | kimi | home | — | .kimi/sessions | wire.jsonl |
| 10 | qwen | home | — | .qwen/projects | *.jsonl |
| 11 | roocode | home | — | .config/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks | ui_messages.json |
| 12 | kilocode | home | — | .config/Code/User/globalStorage/kilocode.kilo-code/tasks | ui_messages.json |
| 13 | mux | home | — | .mux/sessions | session-usage.json |
| 14 | kilo | xdgData | — | kilo/kilo.db | kilo.db |
| 15 | crush | xdgData | — | crush/projects.json | projects.json |
| 16 | hermes | envVar | HERMES_HOME (.hermes) | state.db | state.db |
| 17 | copilot | home | — | .copilot/otel | *.jsonl |
| 18 | goose | xdgData | — | goose/sessions/sessions.db | sessions.db |
| 19 | codebuff | envVar | CODEBUFF_DATA_DIR (.config/manicode) | projects | chat-messages.json |
| 20 | antigravity | config | — | antigravity-cache/sessions | *.jsonl |

### 3.3 特殊扫描逻辑

以下 Agent 有超出标准路径的额外扫描逻辑，需在 scanner 中特殊处理：

- **Codex**：额外扫描 `archived_sessions/` 目录
- **OpenCode**：发现所有 `opencode*.db` 文件（支持 stable/nightly 等 channel）+ legacy JSON 目录
- **OpenClaw**：额外扫描 3 个历史品牌路径（`.clawdbot/agents`、`.moltbot/agents`、`.moldbot/agents`）
- **Pi**：额外扫描 Oh My Pi 路径 `~/.omp/agent/sessions`
- **RooCode / KiloCode**：额外扫描 `.vscode-server/data/User/globalStorage/...`（远程开发）
- **Goose**：5 个优先级路径（`$GOOSE_PATH_ROOT` → XDG → macOS App Support → 旧版 Block 路径）
- **Crush**：读取 `projects.json` 注册表，解析每个项目的 `data_dir` 查找 `crush.db`
- **Codebuff**：扫描 3 个 channel 目录（manicode、manicode-dev、manicode-staging）
- **Copilot**：额外检查 `$COPILOT_OTEL_FILE_EXPORTER_PATH` 环境变量

## 4. 解析器

### 4.1 解析器接口

```typescript
interface AgentParser {
  parseFile(filePath: string): Promise<UnifiedMessage[]>
}
```

每个 Agent 实现一个解析器。所有解析器遵循相同的错误处理模式：
- 文件打开失败 → 返回空数组
- 单行解析失败 → 跳过该行
- 缺少关键字段 → 跳过
- 数值兜底 → `Math.max(0, value ?? 0)`
- 时间戳兜底 → 文件修改时间

### 4.2 Claude Code 解析器

**数据源**：`~/.claude/projects/**/*.jsonl`

**核心逻辑**：
1. 逐行流式读取（`readline`）
2. 快速跳过：行不包含 `"type":"assistant"` 则跳过
3. JSON 解析，提取 `message.usage` 和 `message.model`
4. 去重：`messageId:requestId` 组合键，per-field max merge（同一键的多行取各 token 字段最大值）
5. 子代理检测：三层优先级（`.meta.json` → 父会话 tool_use 推断 → 回退 "claude-code-subagent"）
6. Human turn 检测：区分真正用户输入和工具结果/系统消息

**Token 字段映射**：
- `input_tokens` → input
- `output_tokens` → output
- `cache_read_input_tokens` → cacheRead
- `cache_creation_input_tokens` → cacheWrite
- reasoning 固定为 0

### 4.3 Codex 解析器

**数据源**：`~/.codex/sessions/*.jsonl` + `archived_sessions/*.jsonl`

**核心逻辑**（有状态解析）：
1. 维护 `CodexParseState`：`currentModel`、`previousTotals`、`sessionProvider`
2. 三种事件类型：
   - `session_meta` → 提取 provider、agent、workspace
   - `turn_context` → 提取模型名（5 级优先级查找）
   - `event_msg` + `token_count` → 核心 token 计数
3. 累计值差值计算：Codex 报告累计快照，需要 `current - previous` 得到增量
4. Stale regression 检测：累计值短暂回退时跳过（乱序到达）
5. 延迟模型绑定：`token_count` 可能先于 `turn_context` 到达，暂存后回填

**Token 字段映射**：
- `input_tokens - cached_input_tokens` → input（减去缓存部分）
- `output_tokens` → output
- `cached_input_tokens` → cacheRead
- cacheWrite 固定为 0
- `reasoning_output_tokens` → reasoning

### 4.4 其他解析器

按 tokscale 源码逐个翻译。主要差异：

| Agent | 数据格式 | 特殊处理 |
|-------|----------|----------|
| Gemini | JSON/JSONL（3 种格式） | promptTokenCount 包含 cache，需减去 |
| Cursor | CSV（3 种版本） | 无去重需求 |
| Copilot | OpenTelemetry JSONL | traceId:spanId 去重 |
| OpenCode | SQLite + legacy JSON | 双数据源 |
| RooCode | JSON 数组 | 过滤 `say: "api_req_started"` |
| Kilo/Hermes/Goose/Crush | SQLite | 只读查询 |
| 其余 | JSONL/JSON 变体 | 标准逐行解析 |

## 5. Scanner（文件扫描器）

### 5.1 扫描流程

```
1. 遍历 21 个 ClientDef
2. 解析 root 类型得到绝对路径
3. 检查目录是否存在
4. 递归遍历，按 filePattern 匹配文件
5. 路径去重（canonicalize 后 Set 去重）
6. 返回 ScanResult: Map<clientId, filePath[]>
```

### 5.2 PathRoot 解析（macOS）

| root | 解析结果 |
|------|----------|
| home | `$HOME` |
| xdgData | `$XDG_DATA_HOME` 或 `$HOME/.local/share` |
| config | `$HOME/.config/tokscale` |
| envVar | `$ENV_VAR` 或 `$HOME/{fallbackRelative}` |

### 5.3 增量扫描

使用 `file_fingerprints` 表记录每个文件的 `(size, mtimeMs, bytesParsed)`。刷新时：
- 指纹匹配 → 跳过（cache hit）
- 文件变大 → 从 `bytesParsed` 偏移量开始增量解析
- 文件缩小或 mtime 变化 → 全量重新解析
- 新文件 → 全量解析

## 6. 定价系统

### 6.1 数据源

从 LiteLLM 开源定价数据库获取：`https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`

### 6.2 模型匹配策略

1. 精确匹配 modelId
2. 添加 provider 前缀匹配（`anthropic/`、`openai/` 等）
3. 后缀剥离匹配（去掉日期后缀如 `-20250514`）
4. 模糊匹配（includes 比较）

### 6.3 成本计算

```
cost = inputCost + outputCost + cacheReadCost + cacheWriteCost
```

每项支持 200K token 阈值分层定价：超过 200K 的部分使用 `*_above_200k_tokens` 费率。

### 6.4 离线回退

构建时预取定价数据，打包进应用。网络不可用时使用预取数据。

## 7. 存储层

### 7.1 SQLite 表结构

```sql
-- 文件指纹（增量解析）
CREATE TABLE file_fingerprints (
  file_path TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  bytes_parsed INTEGER NOT NULL DEFAULT 0
);

-- 聚合用量数据（按 client + model + date 聚合）
CREATE TABLE usage_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client TEXT NOT NULL,
  model_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  date TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  turn_count INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  UNIQUE(client, model_id, provider_id, date)
);

-- 全局元数据
CREATE TABLE scan_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### 7.2 数据库位置

`$SYNAPSE_DATA_DIR/token-usage.db`，与 Synapse 现有的 SQLite 基础设施并列。

## 8. 主进程 Service

### 8.1 文件结构

```
desktop/electron/services/token-usage/
├── index.ts                    # service 入口，导出公共 API
├── scanner.ts                  # 文件扫描器
├── clients.ts                  # 21 个 Agent 的 ClientDef 注册表
├── db.ts                       # SQLite 操作
├── pricing.ts                  # LiteLLM 定价获取和计算
├── aggregator.ts               # 数据聚合（按天/月/小时/模型）
└── parsers/
    ├── types.ts                # AgentParser 接口 + UnifiedMessage
    ├── utils.ts                # 共享工具函数
    ├── claude.ts               # Claude Code 解析器
    ├── codex.ts                # Codex 解析器
    ├── gemini.ts               # Gemini 解析器
    ├── cursor.ts               # Cursor CSV 解析器
    ├── copilot.ts              # Copilot OpenTelemetry 解析器
    ├── opencode.ts             # OpenCode SQLite + JSON 解析器
    ├── roocode.ts              # Roo Code 解析器
    ├── amp.ts                  # Amp 解析器
    └── generic-jsonl.ts        # 通用 JSONL 解析器（覆盖 OpenClaw/Pi/Kimi/Qwen/Mux 等简单格式）
```

### 8.2 Service API

```typescript
// 触发全量/增量扫描
async function scanTokenUsage(): Promise<ScanProgress>

// 获取 GraphResult（Overview + 贡献图数据）
async function getGraphResult(options?: { since?: string; until?: string }): Promise<GraphResult>

// 获取模型报告
async function getModelReport(options?: { groupBy?: GroupBy }): Promise<ModelReport>

// 获取小时报告
async function getHourlyReport(): Promise<HourlyReport>

// 获取月度报告
async function getMonthlyReport(): Promise<MonthlyReport>

// 获取已发现的 Agent 列表
async function getDetectedAgents(): Promise<DetectedAgent[]>
```

## 9. IPC 通道

```typescript
const TOKEN_USAGE_CHANNELS = {
  scan: "synapse:token-usage:scan",
  getGraphResult: "synapse:token-usage:graph-result",
  getModelReport: "synapse:token-usage:model-report",
  getHourlyReport: "synapse:token-usage:hourly-report",
  getMonthlyReport: "synapse:token-usage:monthly-report",
  getDetectedAgents: "synapse:token-usage:detected-agents",
}
```

## 10. 前端模块

### 10.1 文件结构

```
desktop/src/modules/token-usage/
├── index.tsx                       # 模块入口，Tab 切换
├── hooks/
│   └── use-token-usage.ts          # IPC 调用封装
├── components/
│   ├── overview-view.tsx           # Overview：堆叠柱状图 + Top Models
│   ├── models-view.tsx             # Models：模型明细表格
│   ├── daily-view.tsx              # Daily：按天表格
│   ├── hourly-view.tsx             # Hourly：按小时表格 + 时段画像
│   ├── stats-view.tsx              # Stats：贡献图 + 统计面板
│   ├── agents-view.tsx             # Agents：按 Agent 表格
│   ├── contribution-graph.tsx      # GitHub 风格热力图组件
│   ├── stacked-bar-chart.tsx       # 堆叠柱状图组件
│   ├── token-table.tsx             # 通用 token 数据表格
│   └── scan-button.tsx             # 扫描/刷新按钮 + 进度
└── lib/
    ├── format.ts                   # 数字格式化（1.2M、$3.45 等）
    └── colors.ts                   # Provider 色系定义
```

### 10.2 六个视图（对齐 tokscale TUI）

**Overview**：
- 上部：堆叠柱状图 "Tokens per Day"，每根柱子按模型堆叠，颜色对应 provider
- 下部：Top Models 排行榜，显示模型名、百分比、五维 token 明细、cost
- 右上角：Total cost

**Models**：
- 表格列：# | Model | Provider | Source | Input | Output | Cache R | Cache W | Total | Cost
- 支持按 Tokens / Cost 排序
- 支持 4 种 GroupBy：Model / ClientModel / ClientProviderModel / WorkspaceModel

**Daily**：
- 表格列：Date | Turns | Msgs | Input | Output | Cache R | Cache W | Total | Cost
- 今天的行高亮
- 支持日期范围过滤

**Hourly**：
- 表格模式：Hour | Source | Turns | Msgs | Input | Output | Cache R | Cache W | Total | Cost
- 时段画像模式：Morning/Daytime/Evening/Night 四时段 + 周一到周日的水平条形图

**Stats**：
- GitHub 风格贡献图（52 周 × 7 天热力图）
- 统计面板：Favorite model、Sessions、Current/Longest streak、Active days、Total tokens/cost
- 点击格子显示日明细

**Agents**：
- 表格列：# | Agent | Source | Tokens | Cost | Msgs

### 10.3 Provider 色系

对齐 tokscale 的 provider 色板：

| Provider | 色系 |
|----------|------|
| Anthropic | 珊瑚色 #DA7756 |
| OpenAI | 绿色 #10B981 |
| Google | 蓝色 #3B82F6 |
| DeepSeek | 青色 #06B6D4 |
| xAI | 黄色 #EAB308 |
| Meta | 靛蓝 #6366F1 |
| Cursor | 紫色 #8B5CF6 |
| Unknown | 灰色 #888888 |

### 10.4 数字格式化

对齐 tokscale 的格式化规则：
- Token 数：`≥1B` → `X.XB`，`≥1M` → `X.XM`，`≥1K` → `XK`，否则带逗号
- 费用：`≥$1000` → `$X.XK`，否则 `$X.XX`
- Cache 倍率：`cacheRead / (input + cacheWrite)`，显示为 `X.Xx`

## 11. 导航集成

在 `App.tsx` 的 tabs 数组中添加：

```typescript
{ id: "token-usage", label: "Token Usage" }
```

在 `CONTENT_MODULE_COMPONENTS` 中注册 `TokenUsageModule` 组件。

## 12. 数据流

```
用户点击 Tab / 刷新按钮
  → 渲染进程调用 IPC synapse:token-usage:scan
  → 主进程 scanner 遍历 21 个 ClientDef
  → 检查文件指纹，增量解析变化的文件
  → 各 parser 输出 UnifiedMessage[]
  → pricing 计算 cost
  → 写入 SQLite usage_daily 表
  → 渲染进程调用 IPC synapse:token-usage:graph-result
  → 主进程 aggregator 从 SQLite 查询聚合
  → 返回 GraphResult
  → 渲染进程渲染六个视图
```

## 13. 实现优先级

分三个阶段：

**Phase 1 — 核心链路**：
- Agent 注册表 + Scanner
- Claude Code + Codex 解析器（本机有数据，可验证）
- SQLite 存储 + 增量解析
- Overview + Daily + Models 三个视图
- 手动刷新

**Phase 2 — 完整覆盖**：
- 剩余 19 个 Agent 的解析器
- Hourly + Stats（贡献图）+ Agents 三个视图
- LiteLLM 定价集成
- 日期范围过滤

**Phase 3 — 体验优化**：
- 扫描进度条
- 时段画像（Hourly Profile 模式）
- 贡献图点击日明细
- GroupBy 切换
- 数据导出（JSON）
