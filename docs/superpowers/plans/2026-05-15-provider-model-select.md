# Provider + Model 选择公共组件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 统一"供应商+模型档位选择"为公共组件 `ProviderModelSelectDialog`，替换 Agent 对话新建的 `ProviderSelectDialog`，接入定时任务 Agent 配置表单，运行时通过 `modelTier` 解析实际模型名。

**Architecture:** 纯选择器组件返回 `{ providerId, modelTier }`。扩展 `AgentMessage` + `ScheduledAgentSendInput` 增加 `modelTier`。在 `session-manager.getOrCreateSession` 中 `buildEnv` 后用 tier 从已构建 env 取对应 model 字段覆盖 `ANTHROPIC_MODEL`。

**Spec:** `docs/superpowers/specs/2026-05-15-provider-model-select-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `desktop/src/types/provider-model.ts` | `ModelTier`, `ProviderModelSelection` 共享类型 |
| Create | `desktop/src/components/provider-model-select-dialog.tsx` | 公共选择 Dialog |
| Create | `desktop/src/components/__tests__/provider-model-select-dialog.test.tsx` | 组件测试 |
| Modify | `desktop/action-packages/builtin/agent/schema.ts` | 增加 `providerId` + `modelTier` |
| Modify | `desktop/action-packages/builtin/agent/manifest.ts` | 增加 defaultConfig + configFields |
| Modify | `desktop/action-packages/builtin/agent/config.renderer.tsx` | 用 Dialog 触发器替换 disabled 按钮 |
| Modify | `desktop/action-packages/builtin/agent/executor.main.ts` | 传入 providerId + modelTier |
| Modify | `desktop/electron/services/agent-runtime/types.ts` | AgentMessage + ScheduledAgentSendInput 增加 modelTier |
| Modify | `desktop/electron/services/agent-runtime/session-manager.ts` | buildEnv 后 tier 覆盖 |
| Modify | `desktop/electron/services/agent-runtime/agent-runtime-service.ts` | sendScheduled 传入字段 |
| Modify | `desktop/src/modules/agent/components/agent-session-sidebar.tsx` | 替换旧 Dialog |
| Modify | `desktop/src/modules/agent/hooks/use-chat-connection.ts` | createSession 接受 modelTier |
| Modify | `desktop/src/modules/agent/hooks/use-agent-chat.ts` | 类型扩展 |
| Modify | `desktop/src/modules/agent/index.tsx` | 传递 modelTier |

---

## Task 1: 共享类型

**Files:** Create `desktop/src/types/provider-model.ts`

- [ ] **Step 1: 创建类型文件**

```typescript
export type ModelTier = "default" | "haiku" | "sonnet" | "opus"

export type ProviderModelSelection = {
  readonly providerId: string
  readonly modelTier: ModelTier
}

export const MODEL_TIERS = ["default", "haiku", "sonnet", "opus"] as const
```

- [ ] **Step 2: Commit** `feat: add ModelTier and ProviderModelSelection shared types`

---

## Task 2: ProviderModelSelectDialog 公共组件

**Files:**
- Create `desktop/src/components/provider-model-select-dialog.tsx`
- Create `desktop/src/components/__tests__/provider-model-select-dialog.test.tsx`

### 组件设计要点

- 打开时调用 `requireSynapseBridge().agent.listProviders()`，过滤 `archived`
- Dialog 内部三列表格：Radio | 名称(~120px) | 模型(竖排 tier 列表)
- 每个 tier 项格式：`档位 (实际模型名)`，如 `Sonnet (claude-sonnet-4-5)`
- provider 未配置某档位（字段为空）→ 不渲染该项
- 点击行 → 选中 provider(Radio 高亮)，点击模型项 → 选中 provider + 高亮该 tier
- 默认预选：active provider + sonnet tier（无 sonnet 则取第一个可用 tier）
- 有 `defaultSelection` 时回显
- 确认按钮在 provider+tier 都选中后才可点击
- 只有一个 provider 时仍显示 Dialog（还需选模型）
- 空列表 → "暂无 Provider"；加载失败 → 错误+重试
- Dialog 宽度 `sm:max-w-2xl`

### Props 接口

```typescript
type ProviderModelSelectDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSelect: (selection: ProviderModelSelection) => void
  readonly defaultSelection?: ProviderModelSelection
}
```

### 内部辅助函数

```typescript
const TIER_CONFIG: Array<{ tier: ModelTier; label: string }> = [
  { tier: "default", label: "主模型" },
  { tier: "haiku", label: "Haiku" },
  { tier: "sonnet", label: "Sonnet" },
  { tier: "opus", label: "Opus" },
]

function tierModelValue(provider: SynapseAgentProvider, tier: ModelTier): string | undefined {
  const raw = tier === "default" ? provider.model
    : tier === "haiku" ? provider.haikuModel
    : tier === "sonnet" ? provider.sonnetModel
    : provider.opusModel
  const trimmed = raw?.trim()
  return trimmed || undefined
}

function availableTiers(provider: SynapseAgentProvider) {
  return TIER_CONFIG.flatMap((c) => tierModelValue(provider, c.tier) ? [c] : [])
}
```

### 测试用例

Mock 模式与现有 `provider-select-dialog.test.tsx` 一致（mock bridge.agent.listProviders、logger、track）。

1. 渲染 provider 行+各 tier 模型名
2. 不渲染空 tier
3. 预选 active provider + sonnet
4. 点击确认返回 `{ providerId, modelTier }`
5. 过滤 archived providers
6. 错误状态+重试
7. 空列表状态
8. 回显 defaultSelection

- [ ] **Step 1: 写测试** → run 确认 FAIL
- [ ] **Step 2: 实现组件** → run 确认 PASS
- [ ] **Step 3: Commit** `feat: add ProviderModelSelectDialog public component`

---

## Task 3: 扩展 AgentActionConfig schema + manifest

**Files:**
- Modify `desktop/action-packages/builtin/agent/schema.ts`
- Modify `desktop/action-packages/builtin/agent/manifest.ts`

- [ ] **Step 1: schema.ts 增加字段**

```typescript
import type { ModelTier } from "../../../src/types/provider-model"

export type AgentActionConfig = {
  projectId: string
  agentType: "claude-code"
  providerId: string          // 新增
  modelTier: ModelTier        // 新增
  mode: SynapseAgentPermissionMode
  prompt: string
  sessionPolicy: "fresh" | "resume"
  timeoutMins?: number | null
}
```

Zod schema 增加：
```typescript
providerId: z.string().min(1),
modelTier: z.enum(["default", "haiku", "sonnet", "opus"]),
```

- [ ] **Step 2: manifest.ts 增加 defaultConfig + configFields**

defaultConfig 增加 `providerId: ""`, `modelTier: "sonnet"`。

configFields 在 agentType 后增加：
```typescript
{ name: "providerId", kind: "string", required: true, description: "Provider ID." },
{ name: "modelTier", kind: "enum", required: true, description: "Model tier.",
  choices: ["default", "haiku", "sonnet", "opus"], defaultValue: "sonnet" },
```

- [ ] **Step 3: Commit** `feat: extend AgentActionConfig with providerId and modelTier`

---

## Task 4: 改造定时任务 Agent 配置表单

**Files:** Modify `desktop/action-packages/builtin/agent/config.renderer.tsx`

- [ ] **Step 1: 替换 disabled 智能体按钮**

移除 `agentBaseDefinition` import 和 `AGENT_DEFINITIONS` 常量。

增加 `import { useState } from "react"` 和 `ProviderModelSelectDialog` import。

将第一个 `<Field data-disabled>` 替换为：

```tsx
<Field>
  <FieldLabel htmlFor="task-action-agent-provider">供应商 + 模型</FieldLabel>
  <FieldContent>
    <Button
      id="task-action-agent-provider"
      type="button"
      variant="outline"
      className="w-full justify-between"
      onClick={() => setProviderDialogOpen(true)}
    >
      <span className="truncate">
        {value.providerId
          ? `${value.providerId} · ${TIER_LABELS[value.modelTier] ?? value.modelTier}`
          : "选择供应商 + 模型"}
      </span>
      <ChevronDown className="size-4 text-muted-foreground" />
    </Button>
    <ProviderModelSelectDialog
      open={providerDialogOpen}
      onOpenChange={setProviderDialogOpen}
      defaultSelection={value.providerId ? { providerId: value.providerId, modelTier: value.modelTier } : undefined}
      onSelect={(s) => onChange({ ...value, agentType: "claude-code", providerId: s.providerId, modelTier: s.modelTier })}
    />
  </FieldContent>
</Field>
```

其中 `TIER_LABELS` = `{ default: "主模型", haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" }`。

- [ ] **Step 2: Commit** `feat: replace disabled agent button with ProviderModelSelectDialog trigger`

---

## Task 5: 主进程 modelTier 管线

**Files:**
- Modify `desktop/electron/services/agent-runtime/types.ts`
- Modify `desktop/electron/services/agent-runtime/session-manager.ts`
- Modify `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- Modify `desktop/action-packages/builtin/agent/executor.main.ts`

### 5a: types.ts

- [ ] `AgentMessage` 增加 `readonly modelTier?: string`
- [ ] `ScheduledAgentSendInput` 增加 `readonly providerId?: string` + `readonly modelTier?: string`

### 5b: session-manager.ts

在 `getOrCreateSession` 中，`const env = await this.deps.providerService.buildEnv(...)` 之后增加：

```typescript
if (input.message.modelTier) {
  const tierModel = resolveTierFromEnv(env, input.message.modelTier)
  if (tierModel) {
    env.ANTHROPIC_MODEL = tierModel
  }
}
```

文件底部增加局部函数（不导出）：

```typescript
function resolveTierFromEnv(env: Record<string, string>, tier: string): string | undefined {
  switch (tier) {
    case "default": return env.ANTHROPIC_MODEL
    case "haiku":   return env.ANTHROPIC_DEFAULT_HAIKU_MODEL
    case "sonnet":  return env.ANTHROPIC_DEFAULT_SONNET_MODEL
    case "opus":    return env.ANTHROPIC_DEFAULT_OPUS_MODEL
    default: return undefined
  }
}
```

**原理：** `buildEnv` 已经将 provider 各模型字段写入 env（`ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL` 等）。tier 覆盖只需从已构建 env 中取对应字段值赋给 `ANTHROPIC_MODEL`，无需再加载 provider。

### 5c: agent-runtime-service.ts

在 `sendScheduled` 方法构建 `message` 时传入 `providerId` + `modelTier`：

```typescript
const message: AgentMessage = {
  projectId: input.projectId,
  sessionKey,
  platform: "scheduled",
  content: input.prompt,
  modeOverride: input.mode,
  agentType: input.agentType,
  providerId: input.providerId,   // 新增
  modelTier: input.modelTier,     // 新增
}
```

`providerId` 在 message 中有值时，`conversation-router.resolveNewConversationProviderId` 会优先使用它，无需改 router。

### 5d: executor.main.ts

在 `execute` 调用 `runtime.sendScheduled` 时传入：

```typescript
providerId: input.config.providerId || undefined,
modelTier: input.config.modelTier || undefined,
```

- [ ] **Step 1: 实现以上 4 个文件改动**
- [ ] **Step 2: 运行** `pnpm --filter @synapse/desktop run typecheck`
- [ ] **Step 3: 运行** `pnpm --filter @synapse/desktop run test -- agent-runtime`
- [ ] **Step 4: Commit** `feat: wire providerId + modelTier through scheduled agent execution`

---

## Task 6: 替换 Agent 对话新建

**Files:**
- Modify `desktop/src/modules/agent/components/agent-session-sidebar.tsx`
- Modify `desktop/src/modules/agent/hooks/use-agent-chat.ts`
- Modify `desktop/src/modules/agent/hooks/use-chat-connection.ts`
- Modify `desktop/src/modules/agent/index.tsx`

### 6a: agent-session-sidebar.tsx

替换 import：
```tsx
// 删除
import { ProviderSelectDialog } from "./provider-select-dialog"
// 新增
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
```

修改 `onCreateSession` prop 类型：
```typescript
onCreateSession: (projectId: string, providerId: string, modelTier?: string) => void
```

替换 Dialog 渲染：
```tsx
<ProviderModelSelectDialog
  open={createProject !== null}
  onOpenChange={(open) => { if (!open) setCreateProject(null) }}
  onSelect={(selection) => {
    if (!createProject?.id) return
    onCreateSession(createProject.id, selection.providerId, selection.modelTier)
    setCreateProject(null)
  }}
/>
```

**注意：** 旧组件有 auto-create（只有一个 provider 时自动跳过 dialog）。Spec 明确说"只有一个 provider 时仍显示 Dialog（因为还需选模型）"。新组件不需要 auto-create。

### 6b: use-agent-chat.ts

`createSession` 类型增加 `modelTier`：
```typescript
createSession: (
  projectId: string,
  providerId?: string,
  mode?: SynapseAgentPermissionMode,
  modelTier?: string,
) => Promise<void>
```

### 6c: use-chat-connection.ts

`createSession` callback 增加参数，传入 bridge：
```typescript
const createSession = useCallback(async (
  projectId: string,
  providerId?: string,
  mode?: SynapseAgentPermissionMode,
  modelTier?: string,
) => {
  // ... 现有逻辑
  const created = await bridge.agent.createSession({
    projectId,
    sessionKey: DEFAULT_LOCAL_SESSION_KEY,
    name: `新会话 ${formatSessionNameTime(new Date())}`,
    agentType: "claude-code",
    providerId,
    mode,
    modelTier,
  })
  // ... 现有逻辑
```

**桥接层检查：** 确认 `bridge.agent.createSession` 的参数类型是否接受 `modelTier`。如果 bridge 类型中 `CreateSessionInput` 不包含该字段，需要在 `desktop/src/types/bridge.ts` 的对应类型中增加 `modelTier?: string`，以及主进程 IPC handler 中将 `modelTier` 透传到 `AgentMessage`。

主进程 `createSession` IPC 最终会调用 `AgentRuntimeService` 的某个方法来创建 conversation。当用户发送第一条消息时，`sendMessage` 构建的 `AgentMessage` 需要包含 `modelTier`。

**最简路径：** conversation 记录已经有 `providerId` 字段。增加一种方式让 `modelTier` 也持久化到 conversation。在 `ConversationEntryV1.agentConfig` 中增加 `modelTier` 字段：

```typescript
agentConfig: input.mode || input.modelTier
  ? { mode: input.mode, modelTier: input.modelTier }
  : undefined
```

然后在 `session-manager.getOrCreateSession` 中，如果 `message.modelTier` 为空，回退到 `conversation.agentConfig?.modelTier`。这样无论是交互对话还是定时任务，tier 都能到达 session-manager。

### 6d: index.tsx

```tsx
onCreateSession={(projectId, providerId, modelTier) =>
  void chat.createSession(projectId, providerId, undefined, modelTier)
}
```

Agent header 中的 `onCreatePermissionModeSession` 也需传递当前 conversation 的 modelTier（如果有）。

- [ ] **Step 1: 实现以上改动**
- [ ] **Step 2: 更新 sidebar 测试** — 调整 `agent-session-sidebar.test.tsx` 使用新的 `ProviderModelSelectDialog` mock
- [ ] **Step 3: 运行测试** `pnpm --filter @synapse/desktop run test -- agent`
- [ ] **Step 4: Commit** `feat: replace ProviderSelectDialog with ProviderModelSelectDialog in Agent`

---

## Task 7: 清理 + 验证

**Files:**
- Delete `desktop/src/modules/agent/components/provider-select-dialog.tsx` (确认无引用后)
- Delete `desktop/src/modules/agent/components/__tests__/provider-select-dialog.test.tsx`

- [ ] **Step 1: 搜索确认** `grep -r "ProviderSelectDialog\|provider-select-dialog" desktop/src/` 无引用
- [ ] **Step 2: 删除旧文件**
- [ ] **Step 3: 全量验证**

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run check:hard-constraints
```

- [ ] **Step 4: Commit** `refactor: remove deprecated ProviderSelectDialog`

---

## 关键设计决策记录

1. **tier 存储策略：** 存 `modelTier` 而非实际模型名。供应商可能更新模型名，存档位可在执行时动态解析到最新值。

2. **tier 解析位置：** 在 `session-manager.getOrCreateSession` 中 `buildEnv` 之后。`buildEnv` 已将 provider 各模型写入 env，tier 覆盖只需 `env.ANTHROPIC_MODEL = env.ANTHROPIC_DEFAULT_{TIER}_MODEL`。不需要额外加载 provider。

3. **不再 auto-create：** 旧 `ProviderSelectDialog` 在只有一个 provider 时自动跳过 dialog。新组件始终显示，因为还需选模型档位。

4. **conversation 持久化 modelTier：** 写入 `agentConfig.modelTier`，让后续消息（如 resume session）也能读到。`session-manager` 中 `message.modelTier ?? conversation.agentConfig?.modelTier` 作为回退。

5. **summarizeConfig 更新：** `builtin-actions.ts` 中 agent 的 `summarizeConfig` 应更新为包含 provider 信息：`${agentLabel} · ${config.providerId} · ${tierLabel}`。
