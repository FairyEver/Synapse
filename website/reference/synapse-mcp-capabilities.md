# Synapse MCP 能力

<!-- Sources: docs/reference/capability-naming-matrix.md; desktop/synapse-capabilities/shared/naming.ts; desktop/synapse-capabilities/shared/registry.ts; desktop/database/shared/capability-registry.ts; desktop/synapse-capabilities/shared/repository-domain.ts; desktop/synapse-capabilities/shared/variable-domain.ts; desktop/synapse-capabilities/shared/scheduler-domain.ts; desktop/synapse-capabilities/shared/workflow-domain.ts; desktop/synapse-capabilities/shared/content-domain.ts; desktop/electron/capabilities/action-router.ts -->

这里的“能力”指一项可被 MCP 或本地 HTTP API 调用的操作，例如列出数据库表、创建数据行、启用定时任务。

Synapse 先在能力清单中定义能力，再把同一项能力暴露到两个入口：

```text
能力清单
  -> MCP 工具
  -> 内部 HTTP action
  -> 服务方法
```

这份参考面向维护者，用于确认当前公开名称，以及新增能力时应遵守的命名规则。

## 事实来源

能力定义以代码中的能力清单为准。

当前核心文件：

- `desktop/database/shared/capability-registry.ts`
- `desktop/synapse-capabilities/shared/repository-domain.ts`
- `desktop/synapse-capabilities/shared/variable-domain.ts`
- `desktop/synapse-capabilities/shared/scheduler-domain.ts`
- `desktop/synapse-capabilities/shared/workflow-domain.ts`
- `desktop/synapse-capabilities/shared/content-domain.ts`
- `desktop/synapse-capabilities/shared/registry.ts`
- `desktop/synapse-capabilities/shared/naming.ts`
- `desktop/electron/capabilities/action-router.ts`

[能力矩阵](/developer/capability-naming-matrix) 记录当前名称。若矩阵与代码不一致，应修正文档或实现，使两者重新对齐。

## 规范能力 ID

规范能力 ID 使用：

```text
<domain>.<resource>.<action>
```

示例：

| 能力 ID | MCP 工具 | HTTP action | 服务方法 |
| --- | --- | --- | --- |
| `database.table.list` | `database_table_list` | `database.table.list` | `databaseTableList` |
| `scheduler.runtime.inspect` | `scheduler_runtime_inspect` | `scheduler.runtime.inspect` | `schedulerRuntimeInspect` |
| `content.skill.create` | `content_skill_create` | `content.skill.create` | `contentSkillCreate` |

公开 JSON 字段使用 camelCase。

## 当前领域

| 领域 | 职责 | 能力清单 |
| --- | --- | --- |
| `database` | 本地表、文件夹、字段、行、选项、日志和 SQL 操作 | `desktop/database/shared/capability-registry.ts` |
| `repository` | 已配置 Synapse 仓库发现 | `desktop/synapse-capabilities/shared/repository-domain.ts` |
| `variable` | 仓库本机变量的查询、写入和删除 | `desktop/synapse-capabilities/shared/variable-domain.ts` |
| `scheduler` | 定时任务、运行记录、运行时状态检查和 action type 查询 | `desktop/synapse-capabilities/shared/scheduler-domain.ts` |
| `workflow` | DAG 工作流定义、节点/边原子操作、执行、布局 | `desktop/synapse-capabilities/shared/workflow-domain.ts` |
| `content` | Rule、Skill、Prompt 的发布、查询、更新和删除 | `desktop/synapse-capabilities/shared/content-domain.ts` |
| `drive` | 云盘文件、文件夹、分享链接和用量管理 | `desktop/synapse-capabilities/shared/drive-domain.ts` |

领域边界必须清晰。跨领域暴露通过 shared registry 和 action router 完成。

## 入口

### MCP 工具

MCP 是外部 Agent 和自动化的公开入口。工具名称由规范能力 ID 派生：把点号替换为下划线。

```text
database.table.list -> database_table_list
scheduler.run.list -> scheduler_run_list
content.skill.create -> content_skill_create
drive.file.upload -> drive_file_upload
```

工具参数使用与 HTTP action 参数一致的公开 JSON 字段名。

### 内部 HTTP Action

本地 HTTP API 是内部 transport，继续服务 stdio MCP bridge。HTTP API 在顶层 `action` 字段接收规范能力 ID。其他顶层字段作为 action 参数。

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

### 服务方法

服务方法使用 lower camelCase。

```text
database.choice_usage.get -> databaseChoiceUsageGet
scheduler.action_type.list -> schedulerActionTypeList
```

## 当前矩阵

完整当前列表见 [能力矩阵](/developer/capability-naming-matrix)。

矩阵只记录当前规范名称，不能成为代码能力清单之外的第二套事实来源。

## Content MCP

Content MCP 暴露 Rule、Skill 和 Prompt 的发布与维护能力。创建或更新前应先调用 `content_type_describe` 获取当前分类、图标、背景色和限制。

Content MCP 的更新和删除只允许修改当前仓库身份创建的资源。它不负责安装内容到编辑器。

## Drive MCP

Drive MCP 暴露云盘文件、文件夹和分享能力。上传未指定 `parentId` 时默认进入用户云盘根目录；上传工具使用服务端准备的直传会话，结果不返回 COS 凭证或预签名上传 URL。

## Repository And Variable MCP

Repository MCP 第一版只提供只读仓库发现。Variable MCP 管理仓库本机变量，变量值默认不返回；只有单个变量读取显式传 `includeValue: true` 时才会返回明文。

## 新增或修改能力

新增同领域能力或未来领域时，使用 [MCP 能力维护指南](/developer/capability-authoring)。

每次能力变更至少检查：

- 规范能力 ID
- MCP 工具名称
- HTTP action
- 服务方法名称
- 领域 dispatcher 归属
- `mutates` / `risk` metadata
- 能力矩阵
- 相关单测
