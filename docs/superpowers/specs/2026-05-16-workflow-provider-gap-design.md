# Workflow MCP Provider 信息缺口修复

> 2026-05-16 · D + A 组合方案

## 背景

Agent 通过 MCP 创建 workflow 时，prompt/switch 节点必须填写 `providerId` 和 `modelTier`，但现有 18 个 workflow MCP 工具中没有任何 Provider 查询能力，导致 agent 无法知道可用的供应商信息。

实际测试中填了假的 `providerId: "test-provider"` 导致执行失败。

## 方案

两个互补策略：

- **D — 工作流级默认 Provider/Model**：`WorkflowDefinition` 新增 `defaultProviderId` + `defaultModelTier`，节点级变为可选，未设置时继承工作流默认。复用现有 `defaultProjectId` 的模式。
- **A — `workflow_node_type_describe` 附带 Provider 摘要**：当 agent 查询 prompt/switch 节点类型时，返回可用 provider 列表。

## 1. 数据层

`src/types/workflow.ts` 的 `WorkflowDefinition` 新增两个字段，紧跟 `defaultProjectId`：

```typescript
defaultProviderId?: string
defaultModelTier?: "default" | "haiku" | "sonnet" | "opus"
```

`electron/modules/workflow/ipc.ts` 的 `workflowDefinitionSchema` 同步更新。

## 2. 节点 Schema

`workflow-nodes/prompt/schema.ts` 和 `workflow-nodes/switch/schema.ts`：

- `providerId`: `z.string().min(1)` → `z.string().optional()`
- `modelTier`: `z.enum(["default", "haiku", "sonnet", "opus"])` → `z.enum(["default", "haiku", "sonnet", "opus"]).optional()`

节点级配置可以不填 provider/model，由工作流默认值兜底。

## 3. 校验

`electron/services/workflow/workflow-validator.ts` 新增校验规则：

对每个 prompt/switch 类型节点：
- 节点 `config.providerId` 为空 **且** 工作流 `defaultProviderId` 为空 → `invalid_config` 错误
- 节点 `config.modelTier` 为空 **且** 工作流 `defaultModelTier` 为空 → `invalid_config` 错误

解析链：**节点级 → 工作流级 → 报错**。不 fallback 到 active provider。

## 4. 执行器

执行时需要 resolved provider/model。在构建 `NodeExecutionInput` 时注入：

```
effectiveProviderId = config.providerId || workflowDefinition.defaultProviderId
effectiveModelTier  = config.modelTier  || workflowDefinition.defaultModelTier
```

注入位置：`workflow-engine.ts` 构建 `NodeExecutionInput` 时，或 `workflow-scheduler.ts` 的执行入口。

`prompt/executor.main.ts` 和 `switch/executor.main.ts` 消费注入后的值，无需感知 fallback 逻辑。

## 5. UI — 全局设置面板

`src/modules/workflow/editor/node-config-panel.tsx` 的 `GlobalSettingsForm` 中，在"默认项目"下方新增"默认供应商"区域：

- 复用 `ProviderModelSelectDialog`，一次选 provider + model（绑定设置，与节点面板体验一致）
- 绑定 `definition.defaultProviderId` + `definition.defaultModelTier`
- 清除按钮恢复到"未设置"状态

节点面板（`prompt/panel.tsx`、`switch/panel.tsx`）适配：
- 当节点未设置 provider 时，按钮显示"继承: {工作流默认供应商名}"（与 projectId 的 "继承: {defaultProjectName}" 一致）
- 节点面板需接收 `defaultProviderId` / `defaultModelTier` / `defaultProviderName` props

## 6. MCP — describe 附带 Provider 摘要

### 6.1 Dispatcher 变更

`electron/capabilities/workflow-dispatcher.ts` 的 `"workflow.node_type.describe"` handler：

当 `nodeType` 为 `prompt` 或 `switch` 时，额外返回 `availableProviders`：

```typescript
availableProviders: [
  { id: string, name: string, haikuModel?: string, sonnetModel?: string, opusModel?: string }
]
```

### 6.2 Deps 变更

`WorkflowDispatchDeps` 新增：

```typescript
listProviders: () => Promise<readonly { id: string; name: string; haikuModel?: string; sonnetModel?: string; opusModel?: string }[]>
```

`electron/bootstrap/descriptors.ts` 注入 `ProviderService.listProviders`，map 为精简结构。

### 6.3 Tool description 变更

`synapse-capabilities/shared/workflow-domain.ts` 的 `workflow_node_type_describe` tool description 更新：

```
"Return the full manifest for a node type including config JSON Schema, port definitions, and field descriptors. For prompt and switch nodes, also returns availableProviders with id, name, and model mappings per tier."
```

## 7. Skill 更新

`resources/templates/skills/synapse-workflow/content.md`：

"Creating a Workflow" 步骤中补充：

> 在创建节点前，调用 `workflow_node_type_describe` 查看节点配置要求和可用的 providers 列表。可在工作流全局设置中配置默认供应商，各节点即可省略 provider 配置。

`resources/templates/skills/synapse-workflow/files/api-reference.md`：

`workflow_node_type_describe` 的 Returns 更新为：

> `{ type, title, color, ports, configFields, configSchema, availableProviders? }`
>
> `availableProviders` 仅在 prompt/switch 节点时返回：`[{ id, name, haikuModel?, sonnetModel?, opusModel? }]`

## 涉及文件

| 文件 | 变更类型 |
|------|---------|
| `src/types/workflow.ts` | +`defaultProviderId?`, +`defaultModelTier?` |
| `electron/modules/workflow/ipc.ts` | schema +2 optional fields |
| `workflow-nodes/prompt/schema.ts` | `providerId`/`modelTier` 改 optional |
| `workflow-nodes/switch/schema.ts` | 同上 |
| `electron/services/workflow/workflow-validator.ts` | 新增 provider 缺失校验 |
| `electron/services/workflow/workflow-engine.ts` | 构建 NodeExecutionInput 时注入 resolved provider |
| `workflow-nodes/prompt/executor.main.ts` | 消费注入后的 resolved provider（可能无改动） |
| `workflow-nodes/switch/executor.main.ts` | 同上 |
| `src/modules/workflow/editor/node-config-panel.tsx` | GlobalSettingsForm 增加 provider 选择 |
| `workflow-nodes/prompt/panel.tsx` | 适配 optional + 继承 placeholder |
| `workflow-nodes/switch/panel.tsx` | 同上 |
| `synapse-capabilities/shared/workflow-domain.ts` | 更新 describe tool description |
| `electron/capabilities/workflow-dispatcher.ts` | describe 附带 provider 列表，deps +`listProviders` |
| `electron/bootstrap/descriptors.ts` | 注入 providerService 到 dispatcher deps |
| `resources/templates/skills/synapse-workflow/content.md` | 补充引导 |
| `resources/templates/skills/synapse-workflow/files/api-reference.md` | describe 返回值更新 |

## 不做

- 不新增独立的 `workflow_provider_list` MCP 工具（方案 B）
- 不 fallback 到 active provider（方案 C 的隐式 fallback）
- 不修改 `conversation-router.ts` 的 provider 解析逻辑
