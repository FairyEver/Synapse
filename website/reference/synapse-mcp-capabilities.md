# Synapse MCP 能力

<!-- Sources: docs/reference/capability-naming-matrix.md; desktop/synapse-capabilities/shared/naming.ts; desktop/synapse-capabilities/shared/registry.ts; desktop/database/shared/capability-registry.ts; desktop/synapse-capabilities/shared/scheduler-domain.ts; desktop/electron/capabilities/action-router.ts -->

Synapse 通过一套 canonical capability surface 暴露本地能力。一个能力先定义在 manifest 中，再通过本地 HTTP API、MCP tool、CLI command 和 service method 对外使用。

```text
capability manifest
  -> HTTP action
  -> MCP tool
  -> CLI command
  -> service method
```

这份参考面向维护者，用于确认当前 public capability 名称，以及新增能力时应遵守的命名规则。

## 事实来源

能力定义以代码中的 manifest 为准。

当前核心文件：

- `desktop/database/shared/capability-registry.ts`
- `desktop/synapse-capabilities/shared/scheduler-domain.ts`
- `desktop/synapse-capabilities/shared/registry.ts`
- `desktop/synapse-capabilities/shared/naming.ts`
- `desktop/electron/capabilities/action-router.ts`

[能力矩阵](/reference/capability-naming-matrix) 记录当前公开名称。若矩阵与 manifest 不一致，应修正文档或实现，使两者重新对齐。

## Canonical ID

Canonical capability id 使用：

```text
<domain>.<resource>.<action>
```

示例：

| Capability id | MCP tool | CLI command | Service method |
| --- | --- | --- | --- |
| `database.table.list` | `database_table_list` | `synapse database table list` | `databaseTableList` |
| `scheduler.runtime.inspect` | `scheduler_runtime_inspect` | `synapse scheduler runtime inspect` | `schedulerRuntimeInspect` |

Public JSON 字段使用 camelCase。CLI flag 使用 kebab-case。

## 当前 Domain

| Domain | 职责 | Manifest |
| --- | --- | --- |
| `database` | 本地表、字段、行、选项、日志和 SQL action | `desktop/database/shared/capability-registry.ts` |
| `scheduler` | 定时任务、运行记录、runtime inspection 和 action type discovery | `desktop/synapse-capabilities/shared/scheduler-domain.ts` |

Domain 需要保持边界清晰。Database 行为留在 Database domain；Scheduler 行为留在 Scheduler domain。跨 domain 暴露通过 shared registry 和 action router 完成。

## Public Surface

### HTTP Action

本地 HTTP API 在顶层 `action` 字段接收 canonical id。其他顶层字段作为 action 参数。

```json
{
  "action": "database.table.list"
}
```

```json
{
  "action": "scheduler.run.list",
  "taskId": "task:1",
  "limit": 5
}
```

### MCP Tool

MCP tool 名称由 canonical id 派生：把点号替换为下划线。

```text
database.table.list -> database_table_list
scheduler.run.list -> scheduler_run_list
```

Tool 参数使用与 HTTP action 参数一致的 public JSON 字段名。

### CLI Command

CLI command 由 canonical id 派生：点号变为空格，snake_case token 变为 kebab-case。

```bash
synapse database table list
synapse scheduler action-type list
```

清晰的资源标识优先使用位置参数。结构化数据使用 JSON flag。

### Service Method

Service method 使用 lower camelCase。

```text
database.choice_usage.get -> databaseChoiceUsageGet
scheduler.action_type.list -> schedulerActionTypeList
```

## 当前矩阵

完整当前列表见 [能力矩阵](/reference/capability-naming-matrix)。

矩阵只记录当前 canonical public names，不能成为 manifest 之外的第二套事实来源。

## 新增或修改能力

新增同域能力或未来 domain 时，使用 [Capability 维护指南](/reference/capability-authoring)。

每次 capability 变更至少检查：

- canonical id
- MCP tool name
- CLI command path
- service method name
- domain dispatcher ownership
- mutation and risk metadata
- matrix update
- relevant unit tests
