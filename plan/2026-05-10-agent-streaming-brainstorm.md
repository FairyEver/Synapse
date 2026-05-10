# Agent 对话流式输出分析与方案

## 现象

用户发送长文本让 Agent 翻译时：
1. 显示 "Agent 处理中"（phase 事件）
2. 等待 ~8 秒，无任何内容输出
3. 思考过程整块出现（非逐字）
4. 最终结果整块出现（非逐字）

期望：思考过程和正文都应像 Claude Code 终端那样逐词/逐字流式显示。

---

## 根因分析

### 数据流全链路

```
Claude Code CLI (subprocess)
  ↓ stdout, ndjson lines
LineEmitter (controlled-runner.ts)
  ↓ onStdoutLine(line) — 按 \n 切割
ClaudeCodeLiveSession.handleLine(line) — 解析 JSON
  ↓ queue.push(AgentEvent)
processLiveTurn 事件循环
  ↓ emitEvent → eventBus.emit
WindowBroadcaster → webContents.send
  ↓ IPC to renderer
bridge.agent.onEvent → appendAgentTimelineEvent
  ↓ state update
React re-render timeline
```

### 每层的流式能力

| 层 | 流式能力 | 瓶颈？ |
|---|---|---|
| LineEmitter | ✅ 逐行实时推送 | 否 |
| handleLine switch | ⚠️ 只处理 `system/assistant/result/control_request`，忽略其他事件类型 | **可能是** |
| AsyncEventQueue → processLiveTurn | ✅ 逐事件处理并立即 emitEvent | 否 |
| EventBus → WindowBroadcaster → IPC | ✅ 同步推送到 renderer | 否 |
| appendAgentTimelineEvent | ✅ 支持拼接多次 text 事件 | 否 |
| React re-render | ✅ 每次 state 更新即渲染 | 否 |

### 根因定位：Claude Code CLI 的 `stream-json` 输出格式

`desktop/electron/services/agent-runtime/adapters/claude-code.ts` 启动参数：

```typescript
const args = [
  "--print",
  "--verbose",
  "--input-format", "stream-json",
  "--output-format", "stream-json",
  "--permission-prompt-tool", "stdio",
]
```

Claude Code CLI 的 `--output-format stream-json` 输出的是 **消息级事件**，不是 **token 级流式 delta**：

- `{"type": "system", "session_id": "..."}` — 会话开始
- `{"type": "assistant", "message": {"content": [{type: "thinking", thinking: "完整思考内容"}, {type: "text", text: "完整文本"}]}}` — **整个 assistant 消息完成后**才输出
- `{"type": "result", "result": "..."}` — turn 结束

**关键问题**：Claude Code 在终端中逐字显示是因为它内部直接渲染到 terminal stdout，但 `stream-json` 格式是给外部消费者用的结构化事件流，粒度是 message/content-block 级别，不是 token 级别。

因此 `handleAssistant` 处理的每个 `assistant` 事件已经包含完整的 thinking 和 text 内容块，一次性推入队列：

```typescript
// 一个 assistant 事件包含所有 content blocks
private handleAssistant(raw: Record<string, unknown>): void {
  const content = message?.content // 完整 content 数组
  for (const item of content) {
    // thinking: 完整的思考内容一次性 push
    // text: 完整的文本一次性 push
  }
}
```

### 可能存在的第二个问题：被忽略的 delta 事件

`handleLine` 的 `default` 分支静默丢弃所有未识别事件类型：

```typescript
case "control_cancel_request":
case "user":
default:
  break // 👈 所有未知类型被忽略
```

新版 Claude Code CLI 可能已经输出 `content_block_start`、`content_block_delta`、`content_block_stop` 等 token 级事件，但适配器完全忽略了它们。需要通过实际抓取 CLI 输出来验证。

---

## 解决方案（按实现复杂度排序）

### 方案 A：处理 Claude Code CLI 的增量 delta 事件（推荐首选验证）

**假设**：新版 Claude Code CLI 在 `stream-json` 模式下可能已输出 `content_block_delta` 事件。

**验证步骤**：
1. 手动运行 `claude --print --output-format stream-json --input-format stream-json --verbose` 并观察实际输出
2. 如果存在 `content_block_delta` 事件，在 `handleLine` 中添加对应处理

**改动范围**：
- `adapters/claude-code.ts` — 新增 `handleContentBlockDelta`、`handleContentBlockStart`、`handleContentBlockStop` 处理
- 需要为增量 text 和 thinking 维护累积状态

**示例伪代码**：
```typescript
case "content_block_start":
  this.handleContentBlockStart(raw)
  break
case "content_block_delta":
  this.handleContentBlockDelta(raw)
  break
case "content_block_stop":
  this.handleContentBlockStop(raw)
  break
```

---

### 方案 B：直接使用 Anthropic Messages API（绕过 CLI）

新增一个 `claude-api` 适配器，直接调用 Anthropic Messages Streaming API：
- 使用 SSE streaming，收到 `content_block_delta` 就 emit 一个 AgentEvent
- 完全控制 token 级粒度

**优点**：
- 保证最细粒度流式
- 不受 CLI 版本影响

**缺点**：
- 需要管理 API key、模型选择、会话上下文等
- Claude Code CLI 的会话恢复、tool_use 等能力需要自己实现
- 工作量大

---

### 方案 C：UI 层打字机效果兜底（渲染层模拟）

对于不支持 token 级流式的 Agent 或一次性到达的大块文本，在 UI 层添加逐字渲染动画：

**改动范围**：
- `src/modules/agent/components/agent-message-event.tsx` — 新增 `useStreamingReveal` hook
- `src/modules/agent/components/agent-thinking-event.tsx` — 同理

**行为**：
- 新增文本到达时，逐步展开（如每 10ms 显示一个 chunk）
- 全部展示后标记 `revealed: true`，后续重渲染不再动画
- 滚动到底部时平滑跟随

**优点**：
- 对所有 Agent 类型通用
- 改动局部，不影响后端

**缺点**：
- 不是真正的流式，只是视觉效果
- 延迟略增（动画播放时间）
- 对于工具调用等中间步骤意义不大

---

### 方案 D：混合方案（推荐最终形态）

分层设计，兼容不同 Agent 的能力差异：

```
┌──────────────────────────────────────────────────┐
│              UI Timeline Display Layer            │
│  - 支持 streaming reveal (方案 C 兜底)           │
│  - 对于 partial=true 的 event 逐字展示           │
│  - 对于 partial=false 的 event 立即全部展示      │
└──────────────────────────────────────────────────┘
         ▲
         │ AgentEvent + streaming metadata
┌──────────────────────────────────────────────────┐
│            Event Normalization Layer              │
│  - AgentEvent 新增 optional: partial?: boolean   │
│  - streaming adapter 可以发多次 partial event    │
│  - non-streaming adapter 发完整 event            │
└──────────────────────────────────────────────────┘
         ▲
         │
┌──────────────────────────────────────────────────┐
│              Agent Adapters                       │
│  - claude-code: 处理 delta 事件 (方案 A)         │
│  - claude-api: 原生流式 (方案 B, future)         │
│  - codex/hermes: 非流式, 一次性输出              │
└──────────────────────────────────────────────────┘
```

---

## 建议实施路径

### Phase 1: 验证 + 快速 Win

1. **验证 CLI 输出**：实际运行 Claude Code CLI 观察 `stream-json` 输出是否已包含 delta 事件
2. **如果有 delta**：实现方案 A（改适配器，预计 1-2 天）
3. **如果没有 delta**：实现方案 C（UI 打字机效果兜底，预计 0.5-1 天）

### Phase 2: 架构规范化

4. 在 `AgentEvent` type 系统中新增 streaming 元信息（`partial` / `streamId`）
5. 在 `appendAgentTimelineEvent` 中添加对 partial event 的合并逻辑
6. UI 层根据 partial 状态决定是否动画展示

### Phase 3: 长期（可选）

7. 评估是否需要方案 B（直接 API 调用）用于不通过 CLI 的场景

---

## 关键发现：`--include-partial-messages` 参数

通过查阅 Claude Code 官方文档确认：

**CLI 支持 token 级流式输出，但需要显式添加 `--include-partial-messages` 参数！**

```bash
claude -p --output-format stream-json --include-partial-messages "query"
```

加上此参数后，CLI 会输出 `stream_event` 类型的事件：
```json
{"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "逐字"}}}
```

可用 jq 过滤验证：
```bash
claude -p "Write a poem" --output-format stream-json --verbose --include-partial-messages | \
  jq -rj 'select(.type == "stream_event" and .event.delta.type? == "text_delta") | .event.delta.text'
```

### 当前 Synapse 适配器缺失这个参数

`buildClaudeCodeArgs` 中没有 `--include-partial-messages`，所以：
- CLI 只输出 `system`、`assistant`、`result`、`control_request` 等完整事件
- 没有 `stream_event` / `content_block_delta` token 级事件
- 这就是为什么内容一次性全部出现

### 修复方向明确

1. 在 `buildClaudeCodeArgs` 中添加 `"--include-partial-messages"`
2. 在 `handleLine` 的 switch 中新增 `case "stream_event"` 分支
3. 解析 `content_block_delta` → 提取 `text_delta.text` 和 `thinking_delta.thinking`
4. 推入 partial AgentEvent 到队列

---

## 需要验证的关键假设（已添加日志）

已在 `claude-code.ts` 的 `handleLine` 中添加 `[claude-code-raw]` 日志，会打印：
- 每个事件的 type
- assistant 事件的 content blocks 详情
- stream_event 的 delta 详情（如果有的话）

验证步骤：
1. 启动 Synapse 开发模式
2. 发送一条较长的翻译请求给 Agent
3. 查看 Electron 主进程日志中的 `[claude-code-raw]` 输出
4. 确认是否只有 `system` → `assistant` → `result`（无 stream_event）

---

## 相关代码位置

| 文件 | 职责 |
|---|---|
| `desktop/electron/services/agent-runtime/adapters/claude-code.ts` | CLI 输出解析，**核心修改点** |
| `desktop/electron/services/agent-runtime/message-router.ts:704-741` | live turn 事件循环 |
| `desktop/electron/services/agent-runtime/types.ts` | AgentEvent 类型定义 |
| `desktop/electron/runtime/process/controlled-runner.ts:641-678` | LineEmitter 逐行推送 |
| `desktop/src/lib/agent-timeline.ts:137-172` | `appendAgentTimelineEvent` 事件合并 |
| `desktop/src/modules/agent/hooks/use-chat-events.ts:162-192` | renderer 事件消费 |
| `desktop/src/modules/agent/components/agent-message-event.tsx` | 消息渲染（UI 方案改动点） |
| `desktop/src/modules/agent/components/agent-thinking-event.tsx` | 思考渲染（UI 方案改动点） |
