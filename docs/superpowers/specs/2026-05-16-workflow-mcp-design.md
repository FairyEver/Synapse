# Workflow MCP Domain Design

通过 MCP 向外部 Agent 暴露 Synapse 工作流的完整操作能力。

## 方案选型

**方案 A：复用现有 capability 体系，新增 workflow domain。**

与 database / scheduler 完全一致的三层架构：capability 定义 → dispatcher → action router。Agent 只需一个 MCP server 即可访问 database + scheduler + workflow 全部能力。

## Capability 清单

共 18 个 tool，分为 5 类。

### 发现类（2 个）

| Capability ID | MCP Tool | 说明 | mutates |
|---|---|---|---|
| `workflow.node_type.list` | `workflow_node_type_list` | 列出所有节点类型（含简要描述）。tool description 嵌入系统模型简介 | false |
| `workflow.node_type.describe` | `workflow_node_type_describe` | 返回单个节点类型的完整 manifest + config JSON Schema | false |

### 读操作（5 个）

| Capability ID | MCP Tool | 说明 | mutates |
|---|---|---|---|
| `workflow.definition.list` | `workflow_definition_list` | 列出所有工作流 meta | false |
| `workflow.definition.get` | `workflow_definition_get` | 获取完整 definition JSON | false |
| `workflow.definition.inspect` | `workflow_definition_inspect` | 校验 definition，返回 errors + warnings | false |
| `workflow.run.get` | `workflow_run_get` | 按 runId 查询运行状态 | false |
| `workflow.run.list` | `workflow_run_list` | 查询某工作流的运行历史 | false |

### 整体写操作（3 个）

| Capability ID | MCP Tool | 说明 | mutates |
|---|---|---|---|
| `workflow.definition.create` | `workflow_definition_create` | 创建空工作流（含默认 end 节点） | true |
| `workflow.definition.update` | `workflow_definition_update` | 整体替换 definition（校验后保存） | true |
| `workflow.definition.delete` | `workflow_definition_delete` | 删除工作流（同时取消运行中的 run、清理快照） | true |

### 执行类（2 个）

| Capability ID | MCP Tool | 说明 | mutates |
|---|---|---|---|
| `workflow.run.execute` | `workflow_run_execute` | 运行工作流（返回 runId，Agent 轮询 run_get 获取进度） | true |
| `workflow.run.disable` | `workflow_run_disable` | 取消运行中的工作流 | true |

### 原子写操作（6 个）

所有原子操作内部执行 get → mutate → validate → save，校验不通过则不保存。

| Capability ID | MCP Tool | 说明 | mutates |
|---|---|---|---|
| `workflow.node.create` | `workflow_node_create` | 添加节点（position 可选，自动布局） | true |
| `workflow.node.update` | `workflow_node_update` | 更新节点配置/名称/位置（config 整体替换） | true |
| `workflow.node.delete` | `workflow_node_delete` | 删除节点及其关联边 | true |
| `workflow.edge.create` | `workflow_edge_create` | 添加边（switch 节点可带 branch） | true |
| `workflow.edge.delete` | `workflow_edge_delete` | 删除边 | true |
| `workflow.param.update` | `workflow_param_update` | 替换 params 数组（传 [] 清空） | true |

## MCP Tool Schema

### 发现类

#### workflow_node_type_list

tool description 嵌入系统模型简介：DAG 执行模型、变量语法 `{{变量名}}`、图约束（必须有 end 节点、无环）、推荐调用顺序。

```
Input:  {}
Output: [{ type: string, title: string, description: string }]
```

#### workflow_node_type_describe

```
Input:  { nodeType: string }                        // required
Output: {
  type: string,
  title: string,
  description: string,
  ports: {
    inputs: [{ id: string, label: string }],
    outputs: [{ id: string, label: string }] | "dynamic"
  },
  configSchema: object,                             // JSON Schema（Zod 转换）
  configFields: [{ name, kind, label, optional? }]
}
```

### 读操作

#### workflow_definition_list

```
Input:  {}
Output: [{ id, name, description?, version, nodeCount, createdAt, updatedAt }]
```

#### workflow_definition_get

```
Input:  { workflowId: string }                      // required
Output: WorkflowDefinition | null
```

#### workflow_definition_inspect

```
Input:  { definition: WorkflowDefinition }           // required
Output: { valid: boolean,
          errors: [{ type, nodeId?, edgeId?, message }],
          warnings: [{ type, nodeId?, message }] }
```

#### workflow_run_get

```
Input:  { runId: string }                            // required
Output: { runId, workflowId, status, nodeResults,
          startedAt, endedAt?, durationMs?, error? } | null
```

#### workflow_run_list

```
Input:  { workflowId: string, limit?: number }       // workflowId required
Output: [{ runId, workflowId, version, startedAt, endedAt?, status, params }]
```

### 整体写操作

#### workflow_definition_create

```
Input:  { name?: string }                            // 默认 "新工作流"
Output: { id: string, versionHash: string }
```

#### workflow_definition_update

```
Input:  { definition: WorkflowDefinition }           // required, 含 id
Output: { versionHash: string } | { errors: [...] }
```

#### workflow_definition_delete

```
Input:  { workflowId: string }                       // required
Output: {}
```

### 执行类

#### workflow_run_execute

```
Input:  { workflowId: string, params?: Record<string, unknown> }
Output: { runId: string } | { errors: [...] }
```

#### workflow_run_disable

```
Input:  { runId: string }                            // required
Output: {}
```

### 原子写操作

#### workflow_node_create

```
Input:  { workflowId: string,
          node: { name: string, type: string,
                  position?: { x: number, y: number },
                  config?: Record<string, unknown> } }
Output: { nodeId: string, versionHash: string } | { errors: [...] }
```

position 不传时 dispatcher 自动布局（现有节点最大 x + 250，y 取均值）。

#### workflow_node_update

```
Input:  { workflowId: string,
          nodeId: string,
          patch: { name?: string,
                   position?: { x: number, y: number },
                   config?: Record<string, unknown> } }
Output: { versionHash: string } | { errors: [...] }
```

config 为整体替换（非合并）。

#### workflow_node_delete

```
Input:  { workflowId: string, nodeId: string }
Output: { versionHash: string, removedEdgeCount: number } | { errors: [...] }
```

自动删除关联的边。不允许删除 end 节点。

#### workflow_edge_create

```
Input:  { workflowId: string,
          from: string, to: string, branch?: string }
Output: { edgeId: string, versionHash: string } | { errors: [...] }
```

#### workflow_edge_delete

```
Input:  { workflowId: string, edgeId: string }
Output: { versionHash: string } | { errors: [...] }
```

#### workflow_param_update

```
Input:  { workflowId: string,
          params: [{ name: string, type: "text"|"number",
                     default?: string|number|null,
                     description?: string }] }
Output: { versionHash: string } | { errors: [...] }
```

## Agent 发现机制

三层分级：

1. **Tool description**（所有 MCP 客户端自动可见）：写在 `workflow_node_type_list` 的 description 中，简要说明 DAG 模型、变量语法、图约束、推荐调用顺序。约 300 字。
2. **MCP Tool 动态查询**：`workflow_node_type_list` 返回节点类型摘要，`workflow_node_type_describe` 返回完整 config JSON Schema 和端口定义。节点类型从 `NodeTypeRegistry` 动态读取，始终与运行时同步。
3. **Skill / Rule 文件**（可选注入）：`desktop/docs/workflow-mcp-guide.md` 提供完整文档、示例工作流 JSON、常见模式和最佳实践。用户可选择性注入到 Agent 上下文。

## 节点位置自动布局

Agent 创建节点时 position 为可选字段。不传时 dispatcher 自动计算：

- 取现有节点最大 x + 250 作为新节点 x
- 取现有节点 y 均值作为新节点 y
- 空工作流首个节点位于 (200, 200)

## UI 实时反映

MCP 写操作保存后通过 EventBus 通知 renderer，编辑器实时刷新。

### 数据流

```
Agent ──MCP──> HTTP API ──> action-router ──> workflow-dispatcher
                                                    │
                                          WorkflowService.save()
                                                    │
                                          EventBus.emit("workflow:definition-updated")
                                                    │
                                          renderer 编辑器监听 → 重新加载 definition
```

### 事件格式

```typescript
{
  domain: "workflow",
  type: "workflow:definition-updated",
  payload: { workflowId: string, source: "mcp", versionHash: string },
  timestamp: string
}
```

### 冲突处理

| 编辑器状态 | 处理 |
|---|---|
| 无未保存修改 | 静默刷新画布 |
| 有未保存修改 | MCP 版本覆盖本地，显示 toast 通知 |

MCP 写入总是经过 validate + save，是可信的最新版本。

## 架构与文件结构

### 新增文件

| 文件 | 职责 |
|---|---|
| `synapse-capabilities/shared/workflow-domain.ts` | capability 定义 + MCP tool schema + 构建函数 |
| `electron/capabilities/workflow-dispatcher.ts` | action → service 调度（整体 + 原子） |
| `desktop/docs/workflow-mcp-guide.md` | Agent 深度参考文档（可选 skill 文件） |

### 改动文件

| 文件 | 变化 |
|---|---|
| `synapse-capabilities/shared/registry.ts` | 注册 WORKFLOW_DOMAIN |
| `electron/capabilities/action-router.ts` | 添加 workflow domain 路由 |
| `electron/bootstrap/` | 创建 dispatcher 实例并接线 |
| `electron/modules/workflow/ipc.ts` | 注册 `workflow:definition-updated` 事件类型 |
| `src/modules/workflow/editor/` | 监听外部变更事件，刷新画布 |

### Dispatcher 依赖注入

```typescript
type WorkflowDispatchDeps = {
  workflowService: WorkflowService
  snapshotService: RunSnapshotService
  nodeTypeRegistry: NodeTypeRegistry
  eventBus: EventBus
  runWorkflow: (id: string, params: Record<string, unknown>) =>
    Promise<{ runId: string } | { errors: ValidationError[] }>
  cancelRun: (runId: string) => void
  getRunStatus: (runId: string) => Promise<WorkflowRunStatus | null>
}
```

### 原子操作统一模式

```typescript
async function atomicMutate(
  workflowId: string,
  mutate: (def: WorkflowDefinition) => { result?: Record<string, unknown> },
): Promise<DispatchResult> {
  const def = await deps.workflowService.get(workflowId)
  if (!def) throw new Error("Workflow not found")
  const { result } = mutate(def)
  const validation = validateWorkflow(def)
  if (!validation.valid) return { ok: true, data: { errors: validation.errors } }
  const saveResult = await deps.workflowService.save(def)
  if ("errors" in saveResult) return { ok: true, data: { errors: saveResult.errors } }
  emitDefinitionUpdated(workflowId, saveResult.versionHash)
  return { ok: true, data: { ...result, versionHash: saveResult.versionHash } }
}
```

### Action Router 变更

```typescript
export type SynapseActionRouterDeps = {
  readonly databaseDispatch: DomainDispatch
  readonly schedulerDispatch: DomainDispatch
  readonly workflowDispatch: DomainDispatch      // 新增
}
```

dispatch 函数中添加 `if (domainId === "workflow") return deps.workflowDispatch(...)`.

## 运行进度获取

轮询模式。Agent 调用 `workflow_run_execute` 获得 runId 后，通过 `workflow_run_get` 轮询直到 status 变为 completed / failed / cancelled。

不实现 MCP notification / streaming，保持简单可靠。

## 安全

不做额外权限检查。MCP 连接已由 HTTP token 保护，且仅限 127.0.0.1 本地连接。

## 新增依赖

仅一个：`zod-to-json-schema`（用于 `workflow_node_type_describe` 中 Zod → JSON Schema 转换）。

## Agent 典型使用流程

```
1. workflow_node_type_list()                        → 了解系统模型 + 可用节点类型
2. workflow_node_type_describe({ nodeType: "prompt" }) → 了解 prompt 节点配置
3. workflow_definition_create({ name: "用户问答" })    → 创建空工作流
4. workflow_param_update(...)                         → 定义工作流参数
5. workflow_node_create(...)                          → 添加节点
6. workflow_edge_create(...)                          → 连接节点
7. workflow_node_update(...)                          → 配置节点
8. workflow_definition_inspect(...)                   → 校验
9. workflow_run_execute(...)                          → 运行
10. workflow_run_get(...)                             → 轮询结果
```
