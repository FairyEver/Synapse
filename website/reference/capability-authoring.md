# Capability 维护指南

<!-- Sources: desktop/synapse-capabilities/shared/naming.ts; desktop/synapse-capabilities/shared/registry.ts; desktop/synapse-capabilities/shared/types.ts; desktop/database/shared/capability-registry.ts; desktop/database/shared/mcp-tools.ts; desktop/electron/database/dispatcher.ts; desktop/database/cli/database.ts; desktop/synapse-capabilities/shared/scheduler-domain.ts; desktop/electron/services/task-scheduler/external-capabilities.ts; desktop/database/cli/scheduler.ts; desktop/electron/capabilities/action-router.ts -->

新增或修改通过本地 HTTP API、MCP tool、CLI command、public service method 暴露的 Synapse capability 时，使用这份指南。

Capability manifest 是事实来源。参考文档只记录当前 public surface，不单独定义行为。

## 当前源文件

Shared capability layer:

- `desktop/synapse-capabilities/shared/naming.ts`
- `desktop/synapse-capabilities/shared/registry.ts`
- `desktop/synapse-capabilities/shared/types.ts`

Database domain:

- `desktop/database/shared/capability-registry.ts`
- `desktop/database/shared/mcp-tools.ts`
- `desktop/electron/database/dispatcher.ts`
- `desktop/database/cli/database.ts`

Scheduler domain:

- `desktop/synapse-capabilities/shared/scheduler-domain.ts`
- `desktop/electron/services/task-scheduler/external-capabilities.ts`
- `desktop/database/cli/scheduler.ts`

Routing and transport:

- `desktop/electron/capabilities/action-router.ts`
- `desktop/electron/database/http-server.ts`
- `desktop/electron/database/mcp-server.ts`
- `desktop/database/shared/mcp-rpc.ts`
- `desktop/database/mcp/index.ts`

## 命名规则

Canonical capability id 使用：

```text
<domain>.<resource>.<action>
```

使用 `desktop/synapse-capabilities/shared/naming.ts` 中的 helper 派生 public names：

| Helper | Output |
| --- | --- |
| `capabilityIdToMcpTool("database.table.list")` | `database_table_list` |
| `capabilityIdToCliCommand("database.choice_usage.get")` | `database choice-usage get` |
| `capabilityIdToServiceMethod("scheduler.runtime.inspect")` | `schedulerRuntimeInspect` |

规则：

- domain 和 resource 使用完整英文词。
- Database capability 使用 `database` domain。
- Scheduler capability 使用 `scheduler` domain。
- 默认使用单数 resource；只有语义需要时使用复数，例如 `database.rows.update`。
- 一个 token 内的多词使用 snake_case，例如 `choice_usage`。
- action 使用 `CAPABILITY_ACTIONS` 中的受控词。
- `execute` 只用于 SQL、command、script 或类似执行类能力。
- 会修改数据的能力必须标记 `mutates: true`。
- 高风险执行类能力必须标记 `risk: "high"`。

Public JSON 字段使用 camelCase。CLI flag 使用 kebab-case。

## 新增同域能力

1. 在所属 domain 添加 manifest item。
2. 确认 id 通过 `isCanonicalCapabilityId`。
3. 确认 MCP、CLI、service 名称均由 canonical id 派生。
4. 新增或更新 MCP tool schema。
5. 新增或更新所属 domain dispatcher。
6. 若需要 CLI 暴露，新增或更新 CLI command。
7. HTTP routing 保持使用 canonical action id。
8. 更新 [能力矩阵](/reference/capability-naming-matrix)。
9. 运行相关单测。

Domain 行为留在所属 domain 内。Database capability 不应导入 Scheduler 业务内部实现；Scheduler capability 不应导入 Database 业务内部实现。

## 新增未来 Domain

未来 domain 对外暴露前需要具备：

- Domain id
- Domain manifest
- Domain-owned dispatcher
- Service ownership boundary
- MCP tool definitions or generation path
- CLI namespace if CLI exposure is needed
- HTTP action routing through the shared action router
- Result normalization rules
- Permission and audit handling when sensitive operations are involved
- Tests for domain registration, public name derivation, routing, and hidden operations
- Matrix rows for public capabilities

不要在这份参考里提前定义未来 domain 的具体 resource 名称。只有实现该 domain 时再补具体名称。

## MCP Tool 规则

MCP tool 名称从 canonical id 派生：

```text
database.row.create -> database_row_create
scheduler.task.enable -> scheduler_task_enable
```

MCP schema 应满足：

- 使用 object input schema。
- 对安全查找所需的资源标识设置 required。
- 当名称可能有歧义时，引导 agent 先 list 或 describe resource。
- 除非产品决策明确批准，不暴露破坏性操作。
- 字段名与 HTTP action 参数保持一致。

## CLI 规则

CLI command path 从 canonical id 派生，并暴露在 `synapse` binary 下。

```bash
synapse database row create tasks --data '{"title":"Ship"}'
synapse scheduler run list task:1 --limit 5
```

清晰的资源标识使用位置参数：

- `tableName`
- `columnName`
- `rowId`
- `taskId`

结构化数据使用 JSON flag：

- `--data`
- `--where-json`
- `--params`

## HTTP Action 规则

本地 HTTP API 在顶层 `action` 字段接收 canonical capability id。其他顶层字段作为参数。

```json
{
  "action": "database.row.create",
  "tableName": "tasks",
  "data": {
    "title": "Ship"
  }
}
```

```json
{
  "action": "scheduler.task.enable",
  "taskId": "task:1"
}
```

HTTP server 通过 `createSynapseActionRouter` 路由。新 domain 必须先注册到 shared capability registry，HTTP action 才能 dispatch。

## 示例

### Database Table List

Canonical id:

```text
database.table.list
```

MCP tool:

```text
database_table_list
```

MCP arguments:

```json
{}
```

CLI:

```bash
synapse database table list
```

HTTP body:

```json
{
  "action": "database.table.list"
}
```

Service method:

```text
databaseTableList
```

### Database Row Create

Canonical id:

```text
database.row.create
```

MCP tool:

```text
database_row_create
```

MCP arguments:

```json
{
  "tableName": "tasks",
  "data": {
    "title": "Ship"
  }
}
```

CLI:

```bash
synapse database row create tasks --data '{"title":"Ship"}'
```

HTTP body:

```json
{
  "action": "database.row.create",
  "tableName": "tasks",
  "data": {
    "title": "Ship"
  }
}
```

Service method:

```text
databaseRowCreate
```

### Scheduler Task List

Canonical id:

```text
scheduler.task.list
```

MCP tool:

```text
scheduler_task_list
```

MCP arguments:

```json
{
  "enabled": true,
  "limit": 20
}
```

CLI:

```bash
synapse scheduler task list --enabled --limit 20
```

HTTP body:

```json
{
  "action": "scheduler.task.list",
  "enabled": true,
  "limit": 20
}
```

Service method:

```text
schedulerTaskList
```

### Scheduler Run List

Canonical id:

```text
scheduler.run.list
```

MCP tool:

```text
scheduler_run_list
```

MCP arguments:

```json
{
  "taskId": "task:1",
  "limit": 5
}
```

CLI:

```bash
synapse scheduler run list task:1 --limit 5
```

HTTP body:

```json
{
  "action": "scheduler.run.list",
  "taskId": "task:1",
  "limit": 5
}
```

Service method:

```text
schedulerRunList
```

## Review Checklist

每次 capability 变更都要确认：

- canonical id 符合 `<domain>.<resource>.<action>`。
- domain 拥有对应行为。
- MCP tool、CLI command、service method 均由 canonical id 派生。
- input schema 使用 camelCase public JSON 字段。
- CLI flag 使用 kebab-case。
- mutating 与 high-risk metadata 正确。
- hidden 或 destructive operation 没有被意外暴露。
- [能力矩阵](/reference/capability-naming-matrix) 已更新。
- 相关 capability tests 通过。

相关测试：

```bash
pnpm --filter @synapse/desktop run test -- tests/unit/capability-naming.test.ts tests/unit/synapse-capabilities.test.ts tests/unit/database-capability-parity.test.ts tests/unit/database-mcp-tools.test.ts tests/unit/cli-database.test.ts tests/unit/cli-scheduler.test.ts
```

## 防漂移

当前矩阵可以继续手写，但 review 时必须与 manifest 核对。

后续优先方向：

```text
hand-written explanations
  + generated or checked capability matrix
```

不要把矩阵当成第二套事实来源。当前 capability 定义由 manifest 负责。
