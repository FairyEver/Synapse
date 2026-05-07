# Scheduled Agent Trigger 设计文档

## 概述

为 Synapse 调度器新增 `agent` 动作类型，允许定时任务触发 Agent 会话。触发后在 Agent 面板留下完整对话记录，与手动创建的会话无区别。同时改进 Agent 模块的权限请求 UI 和定时任务会话的视觉标识。

## 架构方案

采用最小侵入方案：调度器直接调用现有 `AgentRuntimeService`，复用现有会话创建、消息路由、事件推送链路，仅新增一个"非 IPC 触发"的入口。

## 1. 调度器 Agent 动作配置模型

```typescript
interface ScheduledAgentAction {
  type: 'agent'
  projectId: string                    // 已有 Synapse 项目 ID
  agentType: 'claude-code' | 'codex'   // Agent 类型
  mode: string                         // 从 unattendedModes 中选取
  prompt: string                       // 要发送的提示词
  sessionPolicy: 'fresh' | 'resume'    // 每次新建 or 复用上次
  maxExecutionTime?: number            // 超时时间（分钟），默认 30
}
```

### Agent 定义扩展

modes 增加 `unattended` 标记：

```typescript
interface AgentModeDefinition {
  id: string
  label: string
  unattended: boolean  // 是否适合无人值守场景
}
```

Claude Code unattended modes: `auto`, `bypassPermissions`, `dontAsk`
Codex unattended modes: `full-auto`, `yolo`

### 触发流程

```
SchedulerService.onTrigger(task)
  → task.action.type === 'agent'
  → AgentRuntimeService.sendScheduled(action)
      → 解析 sessionPolicy → create 或 resume
      → SessionRepository.createSession() / findSession()
        - platform: 'scheduled'
      → 设置 mode → 传递给 adapter
      → MessageRouter.send(prompt)
        - Adapter 启动 CLI，带权限参数
      → 事件正常流转
      → 收到 result → 更新 ScheduledTaskAgentState
      → 超时检测 → kill + error
```

## 2. 会话生命周期

### fresh 模式
- 每次触发创建全新会话
- resumePolicy 设为 `fresh`

### resume 模式
- 首次触发创建会话，记录 `conversationId` 到调度任务配置
- 后续触发复用该会话（追加消息）
- 会话已删除时降级为 fresh，更新 conversationId

## 3. CLI 启动参数映射

| Agent | Mode | CLI 参数 |
|-------|------|----------|
| Claude Code | bypassPermissions | `--dangerously-skip-permissions` |
| Claude Code | auto | `--allowedTools '*'` |
| Codex | full-auto | `--approval-mode full-auto` |
| Codex | yolo | `--approval-mode yolo` |

## 4. 超时与异常处理

- 默认超时 30 分钟，可配置 1-120 分钟
- 超时后 kill CLI 进程，写入系统消息，lastStatus 设为 `timeout`

## 5. 调度器侧状态追踪

```typescript
interface ScheduledTaskAgentState {
  lastConversationId?: string
  lastExecutionAt?: string
  lastStatus?: 'success' | 'error' | 'timeout'
  running?: boolean  // 并发保护
}
```

## 6. 错误处理与边界情况

| 场景 | 处理方式 |
|------|----------|
| CLI 二进制不存在 | 会话创建成功但立即写入 error timeline item，lastStatus = error |
| CLI 启动后崩溃 | 捕获 exit event，写入 error item，记录退出码 |
| 执行超时 | kill 进程，写入系统消息，lastStatus = timeout |
| 项目 workspacePath 不存在 | 触发前校验，不存在则跳过，记录 error |
| resume 模式下会话已删除 | 降级为 fresh，创建新会话，更新 lastConversationId |
| 同一任务上次执行未完成 | 本次触发跳过（不排队），通过 running 标记判断 |

并发保护：进程异常退出时确保 `running` 被重置（finally 或 exit 监听）。

## 7. 前端视觉标识

### 会话列表时钟 badge
- 条件：`session.platform === 'scheduled'`
- 实现：Agent 图标右下角叠加 lucide `Clock` icon（10px），absolute 定位

### 对话区胶囊标签
- 现有：`[Agent图标] [Agent名称]`
- 改为：`[Agent图标] [Agent名称] [Clock图标]`
- 时钟图标 muted-foreground 色，与文字齐平

## 8. 权限请求 UI 重设计（交互式会话）

将权限请求从顶部弹出改为内联对话卡片：

- 作为特殊 timeline item 渲染在对话流中
- 使用 Card 组件 + 左侧 2px accent bar
- 卡片内容：工具名称 + 输入详情（可折叠）+ 操作按钮
- 按钮：允许（primary）/ 拒绝（outline）
- 处理后卡片灰化 + 显示结果文字
- 多个权限请求各自独立卡片，按时间排列

注：定时任务会话使用 unattended 模式，不产生权限请求。

## 9. 调度器 UI 配置面板

表单流程：
1. 动作类型选择 `agent`
2. 项目选择器（已有项目列表）
3. Agent 类型选择（Claude Code / Codex）
4. 模式选择（仅展示 unattended: true 的选项）
5. 提示词输入（多行文本）
6. 会话策略（每次新建 / 复用上次）
7. 超时时间（默认 30 分钟）

校验规则：projectId、agentType、mode、prompt 必填；maxExecutionTime 范围 1-120 分钟。

## 10. 改动文件清单

| 层 | 文件/目录 | 改动 |
|----|----------|------|
| Agent 定义 | `desktop/src/definitions/agent/claude-code.ts` | modes 增加 unattended 字段 |
| Agent 定义 | `desktop/src/definitions/agent/codex.ts` | 同上 |
| 类型 | `desktop/src/types/agent.ts` | AgentModeDefinition 类型扩展 |
| 主进程 | `electron/services/agent-runtime/agent-runtime-service.ts` | 新增 sendScheduled() |
| 主进程 | `electron/services/agent-runtime/session-lifecycle.ts` | createScheduledSession() |
| 主进程 | `electron/services/agent-runtime/adapters/claude-code.ts` | bypassPermissions 参数传递 |
| 主进程 | `electron/services/agent-runtime/adapters/codex-exec.ts` | full-auto/yolo 参数传递 |
| 调度器 | 调度器服务 | 新增 agent 动作类型处理 |
| 前端 | `src/modules/agent/components/agent-session-sidebar.tsx` | 时钟 badge |
| 前端 | Agent 胶囊组件 | 时钟图标 |
| 前端 | `src/modules/agent/components/agent-permission-panel.tsx` | 重写为内联卡片 |
| 前端 | `src/modules/agent/components/agent-timeline-item.tsx` | 权限卡片渲染 |
| 调度器 UI | 调度器配置表单 | agent 动作配置面板 |

## 11. 实施优先级

**第一期：核心链路**
1. Agent 定义扩展 unattended 字段
2. AgentRuntimeService.sendScheduled() 实现
3. Adapter 层权限参数映射补全
4. 调度器新增 agent 动作类型 + 触发逻辑
5. 超时与错误处理

**第二期：前端体验**
6. 调度器 UI 配置面板
7. 会话列表时钟 badge
8. 对话区胶囊时钟图标

**第三期：交互优化**
9. 权限请求 UI 重写为内联卡片
