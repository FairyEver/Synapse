# MCP 能力维护指南

<!-- Sources: desktop/synapse-capabilities/shared/naming.ts; desktop/synapse-capabilities/shared/registry.ts; desktop/synapse-capabilities/shared/types.ts; desktop/database/shared/capability-registry.ts; desktop/database/shared/mcp-tools.ts; desktop/electron/database/dispatcher.ts; desktop/synapse-capabilities/shared/automation-domain.ts; desktop/synapse-capabilities/shared/workflow-domain.ts; desktop/synapse-capabilities/shared/content-domain.ts; desktop/electron/capabilities/action-router.ts -->

新增或修改通过 MCP 工具、本地 HTTP API、服务方法暴露的 Synapse MCP 能力时，使用这份指南。

能力清单是事实来源。参考文档只记录当前入口，不单独定义行为。

## 当前源文件

共享能力层：

- `desktop/synapse-capabilities/shared/naming.ts`
- `desktop/synapse-capabilities/shared/registry.ts`
- `desktop/synapse-capabilities/shared/types.ts`

Database 领域：

- `desktop/database/shared/capability-registry.ts`
- `desktop/database/shared/mcp-tools.ts`
- `desktop/electron/database/dispatcher.ts`

Workflow 领域：

- `desktop/synapse-capabilities/shared/workflow-domain.ts`
- `desktop/electron/services/workflow/external-capabilities.ts`

Content 领域：

- `desktop/synapse-capabilities/shared/content-domain.ts`
- `desktop/electron/services/content/external-capabilities.ts`

Routing and transport:

- `desktop/electron/capabilities/action-router.ts`
- `desktop/electron/database/http-server.ts`
- `desktop/electron/database/mcp-server.ts`
- `desktop/database/shared/mcp-rpc.ts`
- `desktop/database/mcp/index.ts`

## 命名规则

规范能力 ID 使用：

```text
app.<namespace>.<resource>.<action>
```

使用 `desktop/synapse-capabilities/shared/naming.ts` 中的 helper 派生公开名称：

| Helper | Output |
| --- | --- |
| `capabilityIdToMcpTool("app.database.table.list")` | `app_database_table_list` |
| `capabilityIdToServiceMethod("app.automation.runtime.inspect")` | `appAutomationRuntimeInspect` |

规则：

- namespace 和 resource 这两个 token 使用完整英文词。
- Database 能力使用 `database` 领域。
- Automation 能力使用 `automation` 领域。
- Workflow 能力使用 `workflow` 领域。
- Resource Repository 能力使用 `resource_repository` 领域。
- 默认使用单数 resource；只有语义需要时使用复数，例如 `app.database.rows.update`。
- 一个 token 内的多词使用 snake_case，例如 `choice_usage`。
- action 使用 `CAPABILITY_ACTIONS` 中的受控词。
- `execute` 只用于 SQL、命令、脚本或类似执行类能力。
- 会修改数据的能力必须标记 `mutates: true`。
- 高风险执行类能力必须标记 `risk: "high"`。

公开 JSON 字段使用 camelCase。

## 新增同领域能力

1. 在所属领域添加能力清单条目。
2. 确认 ID 通过 `isCanonicalCapabilityId`。
3. 确认 MCP 工具、HTTP action、服务方法名称均由规范能力 ID 派生。
4. 新增或更新 MCP 工具 schema。
5. 新增或更新所属领域 dispatcher。
6. HTTP routing 保持使用规范 action ID。
7. 更新 [能力矩阵](/developer/capability-naming-matrix)。
8. 运行相关单测。

领域行为留在所属领域内。跨领域能力应通过 shared action router 连接，不要直接导入其他领域内部实现。

## 新增未来领域

未来领域对外暴露前需要具备：

- 领域 ID
- 领域能力清单
- 领域自有 dispatcher
- 服务所有权边界
- MCP 工具定义或生成路径
- 通过 shared action router 完成的 HTTP action routing
- 结果归一化规则
- 涉及敏感操作时的权限与审计处理
- 覆盖领域注册、公开名称派生、路由和隐藏操作的测试
- 公开能力的矩阵行

不要在这份参考里提前定义未来领域的具体 resource 名称。只有实现该领域时再补具体名称。

## MCP 工具规则

MCP 工具名称从规范能力 ID 派生：

```text
app.database.row.create -> app_database_row_create
app.automation.item.enable -> app_automation_item_enable
app.workflow.definition.inspect -> app_workflow_definition_inspect
```

MCP schema 应满足：

- 使用 object input schema。
- 对安全查找所需的资源标识设置 required。
- 当名称可能有歧义时，引导 agent 先 list 或 describe resource。
- 除非产品决策明确批准，不暴露破坏性操作。
- 字段名与 HTTP action 参数保持一致。

## HTTP Action 规则

本地 HTTP API 是内部 transport，在顶层 `action` 字段接收规范能力 ID。其他顶层字段作为参数。

```json
{
  "action": "app.database.row.create",
  "tableName": "tasks",
  "data": {
    "title": "Ship"
  }
}
```

```json
{
  "action": "app.automation.item.enable",
  "itemId": "automation:1"
}
```

HTTP server 通过 `createSynapseActionRouter` 路由。新领域必须先注册到共享能力注册表，HTTP action 才能 dispatch。

## 示例

### Database 表列表

规范能力 ID:

```text
app.database.table.list
```

MCP 工具:

```text
app_database_table_list
```

HTTP body:

```json
{
  "action": "app.database.table.list"
}
```

服务方法:

```text
databaseTableList
```

### Database 行创建

规范能力 ID:

```text
app.database.row.create
```

MCP 工具:

```text
app_database_row_create
```

MCP 参数:

```json
{
  "tableName": "tasks",
  "data": {
    "title": "Ship"
  }
}
```

HTTP body:

```json
{
  "action": "app.database.row.create",
  "tableName": "tasks",
  "data": {
    "title": "Ship"
  }
}
```

服务方法:

```text
databaseRowCreate
```

### Automation 项目列表

规范能力 ID:

```text
app.automation.item.list
```

MCP 工具:

```text
app_automation_item_list
```

MCP 参数:

```json
{
  "enabled": true,
  "limit": 20
}
```

HTTP body:

```json
{
  "action": "app.automation.item.list",
  "enabled": true,
  "limit": 20
}
```

服务方法:

```text
automationItemList
```

### Workflow 定义检查

规范能力 ID:

```text
app.workflow.definition.inspect
```

MCP 工具:

```text
app_workflow_definition_inspect
```

HTTP body:

```json
{
  "action": "app.workflow.definition.inspect",
  "workflowId": "workflow:1"
}
```

服务方法:

```text
workflowDefinitionInspect
```

## Review Checklist

每次能力变更都要确认：

- 规范能力 ID 符合 `<domain>.<resource>.<action>`。
- 领域拥有对应行为。
- MCP 工具、HTTP action、服务方法均由规范能力 ID 派生。
- input schema 使用 camelCase 公开 JSON 字段。
- mutating 与 high-risk metadata 正确。
- hidden 或 destructive operation 没有被意外暴露。
- [能力矩阵](/developer/capability-naming-matrix) 已更新。
- 相关能力测试通过。

相关测试：

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/capability-naming.test.ts tests/unit/synapse-capabilities.test.ts tests/unit/database-capability-parity.test.ts tests/unit/api-mcp-capability-surface.test.ts
```

## 防漂移

当前矩阵可以继续手写，但评审时必须与能力清单核对。

后续优先方向：

```text
手写说明
  + 生成或校验的能力矩阵
```

不要把矩阵当成第二套事实来源。当前能力定义由能力清单负责。
