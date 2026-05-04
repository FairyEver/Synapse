# Synapse MCP 能力

<!-- Sources: docs/developer/capability-naming-matrix.md; desktop/synapse-capabilities/shared/naming.ts; desktop/synapse-capabilities/shared/registry.ts; desktop/database/shared/capability-registry.ts; desktop/synapse-capabilities/shared/scheduler-domain.ts; desktop/electron/capabilities/action-router.ts -->

这里的“能力”指一项可被 MCP、CLI 或本地 HTTP API 调用的操作，例如列出数据库表、创建数据行、启用定时任务。

Synapse 先在能力清单中定义能力，再把同一项能力暴露到不同入口：

```text
能力清单
  -> HTTP action
  -> MCP 工具
  -> CLI 命令
  -> 服务方法
```

这份参考面向维护者，用于确认当前公开名称，以及新增能力时应遵守的命名规则。

## 事实来源

能力定义以代码中的能力清单为准。

当前核心文件：

- `desktop/database/shared/capability-registry.ts`
- `desktop/synapse-capabilities/shared/scheduler-domain.ts`
- `desktop/synapse-capabilities/shared/registry.ts`
- `desktop/synapse-capabilities/shared/naming.ts`
- `desktop/electron/capabilities/action-router.ts`

[能力矩阵](/developer/capability-naming-matrix) 记录当前公开名称。若矩阵与代码不一致，应修正文档或实现，使两者重新对齐。

## 规范能力 ID

规范能力 ID 使用：

```text
<domain>.<resource>.<action>
```

示例：

| 能力 ID | MCP 工具 | CLI 命令 | 服务方法 |
| --- | --- | --- | --- |
| `database.table.list` | `database_table_list` | `synapse database table list` | `databaseTableList` |
| `scheduler.runtime.inspect` | `scheduler_runtime_inspect` | `synapse scheduler runtime inspect` | `schedulerRuntimeInspect` |

公开 JSON 字段使用 camelCase。CLI flag 使用 kebab-case。

## 当前领域

| 领域 | 职责 | 能力清单 |
| --- | --- | --- |
| `database` | 本地表、字段、行、选项、日志和 SQL 操作 | `desktop/database/shared/capability-registry.ts` |
| `scheduler` | 定时任务、运行记录、运行时状态检查和 action type 查询 | `desktop/synapse-capabilities/shared/scheduler-domain.ts` |

领域边界必须清晰。Database 行为留在 Database 领域；Scheduler 行为留在 Scheduler 领域。跨领域暴露通过 shared registry 和 action router 完成。

## 公开入口

### HTTP Action

本地 HTTP API 在顶层 `action` 字段接收规范能力 ID。其他顶层字段作为 action 参数。

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

### MCP 工具

MCP 工具名称由规范能力 ID 派生：把点号替换为下划线。

```text
database.table.list -> database_table_list
scheduler.run.list -> scheduler_run_list
```

工具参数使用与 HTTP action 参数一致的公开 JSON 字段名。

### CLI 命令

CLI 命令由规范能力 ID 派生：点号变为空格，snake_case token 变为 kebab-case。

```bash
synapse database table list
synapse scheduler action-type list
```

清晰的资源标识优先使用位置参数。结构化数据使用 JSON flag。

### 服务方法

服务方法使用 lower camelCase。

```text
database.choice_usage.get -> databaseChoiceUsageGet
scheduler.action_type.list -> schedulerActionTypeList
```

## 当前矩阵

完整当前列表见 [能力矩阵](/developer/capability-naming-matrix)。

矩阵只记录当前规范公开名称，不能成为代码能力清单之外的第二套事实来源。

## 新增或修改能力

新增同领域能力或未来领域时，使用 [MCP 能力维护指南](/developer/capability-authoring)。

每次能力变更至少检查：

- 规范能力 ID
- MCP 工具名称
- CLI 命令路径
- 服务方法名称
- 领域 dispatcher 归属
- `mutates` / `risk` metadata
- 能力矩阵
- 相关单测
