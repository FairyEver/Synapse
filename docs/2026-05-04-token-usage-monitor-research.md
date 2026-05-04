# Token 用量监控功能 — 技术调研报告

> 日期：2026-05-04
> 目标：分析如何在 Synapse 中实现跨 Agent 的 token 用量监控功能

## 1. 核心发现

所有主流 AI 编码 Agent 都在本地磁盘写日志文件，直接解析这些文件是获取 token 用量数据的最可靠方式。不需要网络代理、不需要 hook 拦截、不需要 API 调用。

## 2. 各 Agent 数据源

### 2.1 Claude Code — 数据完整度：完美

**路径**：
- `~/.claude/projects/**/*.jsonl`（旧版）
- `~/.config/claude/projects/**/*.jsonl`（新版 Linux）
- 支持 `CLAUDE_CONFIG_DIR` 环境变量

**格式**：JSONL，每行一个 JSON 对象。只需解析 `type: "assistant"` 的行。

**关键字段**：
```json
{
  "type": "assistant",
  "timestamp": "2026-05-04T10:30:00.000Z",
  "sessionId": "uuid",
  "cwd": "/path/to/project",
  "message": {
    "model": "claude-opus-4-6",
    "id": "msg_xxx",
    "usage": {
      "input_tokens": 22243,
      "output_tokens": 1162,
      "cache_creation_input_tokens": 219,
      "cache_read_input_tokens": 23777
    }
  },
  "costUSD": 0.0234,
  "requestId": "req_xxx"
}
```

**去重**：用 `messageId:requestId` 组合键。流式响应会产生多条相同 messageId 的行，取各字段最大值合并。

**特殊处理**：
- 子 Agent（subagent）检测：`isSidechain` 标志或从父会话的 `tool_use` 推断
- 文件是 append-only 的，支持增量解析（记录上次读取偏移量）

### 2.2 Codex (OpenAI CLI) — 数据完整度：完美

**路径**：
- `~/.codex/sessions/*.jsonl`
- `~/.codex/archived_sessions/*.jsonl`
- 支持 `CODEX_HOME` 环境变量

**格式**：JSONL，解析 `type: "event_msg"` 且 `payload.type: "token_count"` 的行。

**关键字段**：
```json
{
  "type": "event_msg",
  "payload": {
    "type": "token_count",
    "info": {
      "total_token_usage": {
        "input_tokens": 87489,
        "cached_input_tokens": 46336,
        "output_tokens": 1239,
        "reasoning_output_tokens": 533,
        "total_tokens": 88728
      },
      "last_token_usage": {
        "input_tokens": 51577,
        "output_tokens": 366
      }
    }
  }
}
```

**关键差异**：Codex 记录的是**累计** token 数（`total_token_usage`），不是每次请求的增量。需要维护状态，用当前累计值减去上次累计值得到增量。`last_token_usage` 可以作为增量的替代来源。

**模型信息**：从 `turn_context` 事件中提取，不在 `token_count` 事件里。

**SQLite 补充**：`~/.codex/state_5.sqlite` 的 `threads` 表有 `tokens_used` 字段（会话级汇总），查询更方便但精度不如 JSONL。

### 2.3 Gemini CLI — 数据完整度：好

**路径**：`~/.gemini/tmp/*/chats/*.json` + `*.jsonl`

**格式**：3 种格式共存（结构化 session JSON、headless stats JSON、流式 JSONL）。

**特殊处理**：Gemini 的 `promptTokenCount` 包含 cached token，需要减去 `cachedContentTokenCount` 才是真正的 input token。

### 2.4 Cursor — 数据完整度：差

**路径**：`~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`

**格式**：SQLite，`cursorDiskKV` 表。

**问题**：`tokenCount` 字段经常为 `{inputTokens: 0, outputTokens: 0}`，Cursor 不可靠地填充这个字段。社区已确认此问题。

**替代方案**：tokscale 通过 Cursor 的服务端 API 同步数据到本地 CSV 缓存，但需要用户手动从浏览器 DevTools 提取 session token，且 token 会过期。

### 2.5 GitHub Copilot — 数据完整度：极差

**本地无 token 数据**。只有组织级 REST API（需管理员权限）。

**唯一可能**：Copilot CLI 的 OpenTelemetry 导出（`~/.copilot/otel/*.jsonl`），但这是新功能，覆盖面未知。

### 2.6 其他 Agent

| Agent | 路径 | 格式 | 完整度 |
|-------|------|------|--------|
| Amp | `~/.local/share/amp/threads/T-*.json` | JSON | 好 |
| OpenCode | `~/.local/share/opencode/opencode.db` | SQLite | 好 |
| Roo Code | VS Code globalStorage `ui_messages.json` | JSON | 好 |
| Goose | `~/.local/share/goose/sessions/sessions.db` | SQLite | 好 |

## 3. 参考项目对比

### 3.1 tokscale（推荐主要参考）

- **仓库**：github.com/junhoyeo/tokscale
- **技术栈**：Rust 核心 + TypeScript CLI/Web
- **覆盖**：21 个 Agent（最广）
- **核心价值**：已逆向工程所有 Agent 的数据路径和解析格式
- **参考重点**：
  - `clients.rs` — 所有 Agent 的数据路径声明式定义
  - `sessions/*.rs` — 各 Agent 的解析逻辑
  - `scanner.rs` — 文件发现和并行扫描
  - `UnifiedMessage` — 统一数据模型

### 3.2 ccusage（补充参考）

- **仓库**：github.com/ryoppippi/ccusage
- **技术栈**：TypeScript monorepo
- **覆盖**：5 个 Agent（Claude/Codex/OpenCode/Pi/Amp）
- **核心价值**：TypeScript 实现，可直接复用代码；定价计算最精细
- **参考重点**：
  - `usageDataSchema`（valibot）— JSONL 数据校验 schema
  - `LiteLLMPricingFetcher` — 定价数据获取和缓存
  - `calculateTieredCost` — 分层定价计算（200K 阈值）
  - 可作为 npm 库直接引用（导出 `data-loader` 和 `calculate-cost`）

### 3.3 tokenusage / tu（架构参考）

- **仓库**：github.com/hanbu97/tokenusage
- **技术栈**：Rust
- **覆盖**：3 个 Agent（Claude/Codex/Antigravity）
- **核心价值**：增量缓存实现（214x 加速）
- **参考重点**：
  - 文件指纹（size + mtime）+ seek 增量解析
  - 行级快速跳过（JSON 解析前先做字符串前缀检查）
  - `crossbeam-channel` 生产者-消费者并行模型

## 4. RTK 的拦截机制（补充说明）

RTK 不是 token 监控工具，而是 token 节省工具。它的机制是：

1. 通过 Claude Code 的 `PreToolUse` hook 拦截命令（如 `git status`）
2. 改写为 `rtk git status`
3. RTK 执行命令后智能过滤输出（去掉 LLM 不需要的信息）
4. 过滤后的输出返回给 Claude Code，减少 token 消耗

RTK 的 token 统计只是副产品——记录过滤前后的字符差异（`chars / 4.0` 估算 token 数），存入 SQLite（`~/.local/share/rtk/tracking.db`）。

**RTK 对 Synapse 的参考价值有限**，因为：
- 它的 hook 机制只能拦截工具调用，不能获取 API 级别的 token usage
- 它的 token 估算是粗略的字符计数，不是 API 返回的精确值
- 它只支持 Claude Code 一个 Agent

## 5. 技术方案建议

### 推荐方案：本地文件解析 + 文件监听

**为什么不用网络代理**：
- Cursor 有证书 pinning，拦截困难
- 订阅制用户（Pro/Max）不走自定义 base URL
- 配置复杂，用户体验差

**为什么不用 Hook**：
- Claude Code 的 hook payload 不包含 token usage 数据
- 其他 Agent 的 hook 系统各不相同，没有统一标准

**推荐架构**：

```
Synapse 主进程
├── Agent Scanner（发现本机安装了哪些 Agent）
│   └── 检查各 Agent 的数据目录是否存在
├── File Watcher（监听日志文件变化）
│   └── 使用 chokidar 或 fs.watch 监听 JSONL/JSON/SQLite 变化
├── Parser Registry（各 Agent 的解析器）
│   ├── ClaudeCodeParser — JSONL 解析 + 去重
│   ├── CodexParser — JSONL 有状态解析 + 差值计算
│   ├── GeminiParser — 多格式解析
│   ├── CursorParser — SQLite 查询（数据可能不完整）
│   └── ...更多 Agent
├── Unified Store（统一数据存储）
│   └── SQLite 表：agent + model + session + project + timestamp + tokens
└── Dashboard（渲染进程展示）
    └── 趋势图 + 按 Agent/项目/模型 分组 + 实时更新
```

**优先级建议**：
1. 先做 Claude Code + Codex（数据最完整，用户最多）
2. 再做 Gemini CLI + Amp + OpenCode
3. Cursor 和 Copilot 放最后（数据获取困难）

## 6. 关键技术决策点

| 决策 | 选项 | 建议 |
|------|------|------|
| 数据获取方式 | 文件解析 vs 网络代理 vs Hook | 文件解析（唯一通用方案） |
| 实时性 | 文件监听 vs 定时轮询 | 文件监听（chokidar），变化时增量解析 |
| 存储 | 内存 vs SQLite | SQLite（Synapse 已有 SQLite 基础设施） |
| 解析性能 | 全量 vs 增量 | 增量（记录文件偏移量，只解析新增内容） |
| Agent 发现 | 手动配置 vs 自动扫描 | 自动扫描（检查数据目录是否存在） |
| 定价计算 | 现在做 vs 后面做 | 后面做（先聚焦 token 数量统计） |
