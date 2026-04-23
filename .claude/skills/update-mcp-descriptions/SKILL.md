---
name: update-mcp-descriptions
description: 根据当前代码更新 MCP 工具描述，让 AI 编辑器更好地理解 Synapse Data Store 的能力。Use when 更新MCP、MCP描述、MCP内容、update MCP、sync MCP、MCP工具描述。
---

# Update MCP Descriptions — 同步 MCP 工具描述

## 目标

读取 Synapse Data Store 的最新代码实现，重新生成 MCP 服务器中每个工具的描述文本，使 AI 编辑器（Claude Code / Cursor / Codex）能尽可能准确、完整地理解可用能力。

## 核心原则

1. **代码即真相**：描述必须从 `service.ts` 和 `types.ts` 的实际实现推导，不能凭记忆或猜测。
2. **AI 友好**：描述面向 LLM 消费，要包含足够的上下文让 AI 在没有文档的情况下正确使用工具。
3. **最小改动**：只改 `buildTools()` 中的 description 字符串和 inputSchema，不改 MCP 协议逻辑、不改 ACTION_MAP、不改 service 层。

## 描述质量标准

好的 MCP 工具描述应该：

- 一句话说清工具做什么
- 列出所有支持的参数值（如列类型、操作符、排序方向）
- 说明特殊类型的格式要求（DATE、DATETIME、BOOLEAN、JSON 的输入格式）
- 说明约束和限制（命名规则、保留前缀、默认值）
- 说明返回值结构（返回什么字段、什么类型）
- 对于查询类工具，说明过滤、排序、分页的用法

## 执行流程

### Phase 1：读取当前实现

读取以下文件，提取最新的能力信息：

1. **`desktop/electron/data-store/service.ts`** — 核心实现
   - 所有 public 方法的签名和行为
   - 支持的列类型（`VALID_COLUMN_TYPES`）
   - 支持的 WHERE 操作符（`VALID_WHERE_OPS`）
   - 命名规则（`NAME_PATTERN`、`RESERVED_PREFIX`）
   - 特殊类型处理逻辑（JSON 序列化、BOOLEAN 转换、DATE/DATETIME 校验）
   - 默认值（query 的 limit 默认 100）
   - 自动生成的字段（id 自增主键）

2. **`desktop/electron/data-store/types.ts`** — 类型定义
   - `DataStoreColumnType` 枚举
   - `DataStoreWhereCondition` 操作符
   - `DataStoreOrderBy` 结构
   - `DataStoreQueryParams` 参数

3. **`desktop/data-store/mcp/index.ts`** — 当前 MCP 描述
   - `buildTools()` 函数中每个工具的 description 和 inputSchema
   - `buildTableSummary()` 的动态摘要格式

### Phase 2：对比分析

逐个工具对比当前描述与实际能力，找出：

- 描述中缺失的能力（如新增的列类型、新增的操作符）
- 描述中过时的信息（如已移除的功能）
- 描述不够清晰的地方（AI 可能误用的参数）
- inputSchema 中缺失的 enum 值或 description
- 返回值结构未说明的地方

输出对比清单：
```
## 对比结果

### [工具名]
- 当前描述：[摘要]
- 实际能力：[摘要]
- 差异：[具体差异]
- 建议：[改进方案]
```

### Phase 3：生成新描述

为每个工具编写新的 description，遵循以下模板：

**简单工具**（list_tables、drop_table、delete）：
```
[一句话功能说明]
```

**创建/修改类工具**（create_table、add_column、insert、update）：
```
[功能说明]. [格式要求]. [约束说明]
```

**查询类工具**（query、raw_sql）：
```
[功能说明]. [参数用法]. [限制说明]
```

描述编写规则：
- 英文编写（MCP 协议标准）
- 不超过 3 句话，除非工具确实复杂
- 列类型、操作符等用逗号分隔列出，不用表格
- 格式要求用示例说明（如 `YYYY-MM-DD`）
- 把最常用的信息放在前面

### Phase 4：更新代码

编辑 `desktop/data-store/mcp/index.ts` 中的 `buildTools()` 函数：

1. 更新每个工具的 `description` 字符串
2. 更新 `inputSchema` 中的 `enum` 值（如果列类型有变化）
3. 更新 `inputSchema` 中的 `description` 字段
4. 确保 `buildTableSummary()` 附加的工具列表仍然正确

### Phase 5：验证

1. 检查更新后的代码没有语法错误
2. 确认所有工具的 description 都已更新
3. 确认 inputSchema 中的 enum 与 service.ts 中的常量一致
4. 确认没有引入多余的改动（不改协议逻辑、不改 ACTION_MAP）

## 范围控制

- 只修改 `desktop/data-store/mcp/index.ts` 中的 `buildTools()` 函数
- 不修改 service 层、types、CLI、HTTP server、IPC handlers
- 不新增或删除工具（工具列表由 ACTION_MAP 决定）
- 不修改 `buildTableSummary()` 的逻辑（除非格式需要优化）

## 硬性规则

- **不凭记忆写描述**。每个描述必须从当前代码推导。
- **不改功能代码**。只改描述字符串和 schema 元数据。
- **不遗漏工具**。`buildTools()` 中的每个工具都必须检查和更新。
- **保持动态摘要**。`buildTableSummary()` 附加到 description 的机制不能破坏。
- **直接修改代码**，不生成独立文件。
