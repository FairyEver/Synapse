---
name: update-mcp-descriptions
description: 根据当前代码更新 MCP 工具描述，让 AI 编辑器更好地理解 Synapse Database 的能力。Use when 更新MCP、MCP描述、MCP内容、update MCP、sync MCP、MCP工具描述。
---

# Update MCP Descriptions — 同步 MCP 工具描述

## 目标

读取 Synapse Database 的最新代码实现，更新共享 MCP 工具定义中的 description 与 inputSchema 元数据，使 AI 编辑器（Claude Code / Cursor / Codex）能尽可能准确、完整地理解可用能力。

## 核心原则

1. **代码即真相**：描述必须从 `service.ts` 和 `types.ts` 的实际实现推导，不能凭记忆或猜测。
2. **AI 友好**：描述面向 LLM 消费，要包含足够的上下文让 AI 在没有文档的情况下正确使用工具。
3. **最小改动**：只改 MCP 工具描述和 schema 元数据；不改 MCP 协议逻辑、不改 `MCP_TOOL_ACTIONS` 映射、不改 service 层。
4. **共享定义优先**：当前 HTTP MCP 与 stdio MCP 共用 `desktop/database/shared/mcp-tools.ts`，不要在 transport 文件里复制或分叉工具描述。

## 描述质量标准

好的 MCP 工具描述应该：

- 一句话说清工具做什么
- 列出所有支持的参数值（如 column kind、where 操作符、排序方向、where group combinator）
- 说明特殊 kind 的格式要求（boolean、date、timestamp、single_choice、multi_choice、json、binary）
- 说明约束和限制（命名规则、保留前缀、默认值）
- 说明返回值结构（返回什么字段、什么类型）
- 对于查询类工具，说明过滤、排序、分页的用法
- 避免旧公开词汇：不要把 `ENUM` / `MULTI_ENUM` / `DATETIME` / `DatabaseColumnType` 当作当前接口描述

## 执行流程

### Phase 1：读取当前实现

读取以下文件，提取最新的能力信息：

1. **`desktop/electron/database/service.ts`** — 核心实现
   - 所有 public 方法的签名和行为
   - 支持的 WHERE 操作符（`VALID_WHERE_OPS`：`=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, `CONTAINS`）
   - 排序方向（`VALID_ORDER_DIRS`：`ASC`, `DESC`；对外为 `asc`, `desc`）
   - 命名规则（`NAME_PATTERN`、`RESERVED_PREFIX`）
   - 特殊 kind 处理逻辑（json/multi_choice 序列化、boolean 转换、date/timestamp 校验、choice 校验）
   - 默认值（query 的 limit 默认 100）
   - 自动生成的字段（`id` 自增主键、`created_at`、`updated_at`）
   - raw SQL 限制（系统表、ATTACH/DETACH、DDL 后同步 metadata）

2. **`desktop/electron/database/column-kind.ts`** — kind 与 SQLite affinity
   - `COLUMN_KINDS`
   - `ColumnKind`
   - `kindToAffinity` / `affinityToKind`
   - kind helper（choice、multi_choice、json serialized、boolean、date、timestamp）

3. **`desktop/electron/database/types.ts`** — 类型定义
   - `Column` / `ColumnKind`
   - `DatabaseWhereCondition` 操作符
   - `DatabaseWhereGroup`：`{ combinator: "all" | "any"; conditions: [...] }`
   - `DatabaseOrderBy` 结构
   - `DatabaseQueryParams` 参数

4. **`desktop/database/shared/mcp-tools.ts`** — 当前 MCP 工具定义
   - `buildTools()` 中每个工具的 description 和 inputSchema
   - `columnKindEnum` / `kindDescription`
   - `whereClauseSchema`
   - `MCP_TOOL_ACTIONS` 只读对照，除非用户明确要求新增/删除/重命名工具，否则不要修改

5. **transport 文件只作结构确认，不修改**
   - `desktop/database/shared/mcp-rpc.ts`：`tools/list` 从 `buildTools()` 返回工具列表，`tools/call` 用 `MCP_TOOL_ACTIONS` 派发
   - `desktop/database/mcp/index.ts`：stdio MCP bridge，只负责连接正在运行的 Synapse app
   - `desktop/electron/database/mcp-server.ts`：HTTP MCP server，也复用 shared mcp tools/rpc

### Phase 2：对比分析

逐个工具对比当前描述与实际能力，找出：

- 描述中缺失的能力（如新增的列类型、新增的操作符）
- 描述中过时的信息（如已移除的功能）
- 描述不够清晰的地方（AI 可能误用的参数）
- inputSchema 中缺失的 enum 值或 description
- 返回值结构未说明的地方

输出简短对比清单，避免长报告；除非用户要求保存报告，不要生成独立文件：
```
## 对比结果

### [工具名]
- 差异：[具体差异]
- 建议：[改进方案]
```

### Phase 3：生成新描述

为每个工具编写新的 description，遵循以下模板：

**简单工具**（database_table_list、database_table_delete、delete）：
```
[一句话功能说明]
```

**创建/修改类工具**（database_table_create、add_column、insert、update）：
```
[功能说明]. [格式要求]. [约束说明]
```

**查询类工具**（query、database_sql_execute）：
```
[功能说明]. [参数用法]. [限制说明]
```

描述编写规则：
- 英文编写（MCP 协议标准）
- 不超过 3 句话，除非工具确实复杂
- 列类型、操作符等用逗号分隔列出，不用表格
- 格式要求用示例说明（如 `YYYY-MM-DD`）
- 把最常用的信息放在前面
- 使用当前公开词汇：`kind`, `choices`, `single_choice`, `multi_choice`, `timestamp`
- where 描述必须覆盖三种形状：
  - equality object：`{ column: value }`
  - expression array：`[{ field, op, value }]`
  - group：`{ combinator: "all" | "any", conditions: [...] }`

### Phase 4：更新代码

编辑 `desktop/database/shared/mcp-tools.ts`：

1. 更新每个工具的 `description` 字符串
2. 更新 `inputSchema` 中的 `enum` 值（如果列类型有变化）
3. 更新 `inputSchema` 中的 `description` 字段
4. 必要时更新 schema helper 常量（如 `whereClauseSchema`、`tableNameProp`、`kindDescription`），但仅限描述/schema 元数据
5. 不修改 `MCP_TOOL_ACTIONS`，除非用户明确要求工具级变更

### Phase 5：验证

1. 检查更新后的代码没有语法错误
2. 确认所有 `buildTools()` 工具的 description 和 inputSchema 都已检查
3. 确认 `columnKindEnum` 与 `desktop/electron/database/column-kind.ts` 的 `COLUMN_KINDS` 一致
4. 确认 where schema 与 `DatabaseWhereClause` / `buildWhere()` 支持的 object、array、group 三种形状一致
5. 确认没有引入多余的改动（不改协议逻辑、不改 `MCP_TOOL_ACTIONS`、不改 service/types/CLI/IPC）
6. 推荐验证命令：
   - `pnpm --filter @synapse/desktop run typecheck`
   - 如只改 database MCP bundle，可跑 `pnpm --filter @synapse/desktop run build:database`
   - 如改动较大，可跑 `pnpm --filter @synapse/desktop run build`

## 范围控制

- 默认只修改 `desktop/database/shared/mcp-tools.ts` 中的 MCP 工具 description、inputSchema，以及相关 schema helper 常量。
- 不修改 service 层、types、CLI、HTTP server、stdio bridge、IPC handlers、preload。
- 不新增或删除工具；工具列表由 `MCP_TOOL_ACTIONS` 决定，除非用户明确要求工具级变更。
- 不修改 `desktop/database/shared/mcp-rpc.ts`、`desktop/database/mcp/index.ts`、`desktop/electron/database/mcp-server.ts` 的协议/transport 逻辑。
- 不启动 Synapse、Vite、Electron 或浏览器做运行态验证，除非用户明确要求。

## 硬性规则

- **不凭记忆写描述**。每个描述必须从当前代码推导。
- **不改功能代码**。只改描述字符串和 schema 元数据。
- **不遗漏工具**。`buildTools()` 中的每个工具都必须检查和更新。
- **不制造第二份 MCP 描述**。HTTP MCP 和 stdio MCP 必须继续共享 `desktop/database/shared/mcp-tools.ts`。
- **直接修改代码**，不生成独立文件。
