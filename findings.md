# 发现与决策

## 需求
- ENUM 类型：建表时定义允许的值列表，写入时验证，AI 能看到合法选项
- 典型场景：记账的"收入/支出"、订单状态"待处理/已完成/已取消"

## 全链路审查（DDL + DML）

### 一、结构操作（DDL）

| 操作 | SQLite | Service | IPC | HTTP | MCP | UI |
|------|--------|---------|-----|------|-----|----|
| CREATE TABLE + ENUM 列 | ENUM 类型名，TEXT 亲和 | 校验 enumValues 非空，写 _meta_columns | ✓ 透传 | ⚠️ 类型断言缺 enumValues | ✓ schema 加字段 | ✓ 建表对话框 |
| ADD COLUMN ENUM | ALTER TABLE | 校验 enumValues，写 _meta_columns，校验 default | ✓ 透传 | ⚠️ 类型断言缺 enumValues | ✓ schema 加字段 | ✓ 表结构 Sheet |
| DESCRIBE TABLE | PRAGMA 返回 "ENUM" | 合并 _meta_columns.enum_values | ✓ | ✓ | ✓ 但 buildTableSummary 需显示值 | ✓ |
| UPDATE ENUM VALUES | — | 新方法，更新 _meta_columns + 刷新缓存 | ✓ 新 channel | ✓ 新 case | ✓ 新工具 | ✓ 表结构 Sheet 编辑 |
| DROP TABLE | DROP TABLE | 已有 _meta_columns 级联删除 + 清缓存 | ✓ | ✓ | ✓ | ✓ |

### 二、数据操作（DML）

| 操作 | 需要 ENUM 处理？ | 处理方式 |
|------|-----------------|---------|
| INSERT | ✓ 写入验证 | 检查值在 enumValues 中（null/空跳过） |
| BATCH INSERT | ✓ 同上 | 逐行验证 |
| UPDATE | ✓ 写入验证 | 同 INSERT |
| DELETE | ✗ | 按 id 删除，无需验证 |
| QUERY (SELECT) | ✗ | ENUM 存为 TEXT，直接返回 |
| QUERY WHERE | ✗ | TEXT 比较，无需转换 |
| QUERY ORDER BY | ✗ | TEXT 排序，自然工作 |
| RAW SQL | ✗ | 绕过验证，可接受 |

### 三、缓存管理

| 项目 | 现状 | ENUM 需要 |
|------|------|----------|
| jsonColumns | Map<table, Set<colName>> | — |
| booleanColumns | 同上 | — |
| dateColumns | 同上 | — |
| datetimeColumns | 同上 | — |
| **enumColumns** | 不存在 | **Map<table, Map<colName, string[]>>**（需要存允许值列表） |
| refreshJsonColumnCache | 只读 PRAGMA table_info | **⚠️ 需额外查 _meta_columns 获取 enum_values** |
| createTable 后更新 | 更新各缓存 | ✓ 更新 enumColumns |
| addColumn 后更新 | 更新各缓存 | ✓ 更新 enumColumns |
| dropTable 后清理 | 清各缓存 | ✓ 清 enumColumns |
| updateColumnEnumValues 后 | — | **✓ 刷新 enumColumns 对应条目** |

### 四、数据库迁移与导入

| 场景 | 现状 | 问题 |
|------|------|------|
| 已有数据库升级（无 enum_values 列） | ensureSystemSchema 用 ALTER TABLE ADD COLUMN | ✓ 兼容 |
| **importDatabase** | 导入后只调 refreshJsonColumnCache | **⚠️ 缺 ensureSystemSchema()，旧库无 _meta_columns 表会崩** |
| exportDatabase | 文件级复制 | ✓ _meta_columns 随库导出 |

### 五、新发现的遗漏

1. **importDatabase 缺 ensureSystemSchema()** — 导入旧版数据库（无 _meta_columns 表）后，refreshJsonColumnCache 查询 _meta_columns 会报错。需要在导入后先调 ensureSystemSchema() 再刷缓存。
2. **refreshJsonColumnCache 不够** — ENUM 缓存需要允许值列表，PRAGMA table_info 只能识别类型名。需要额外查 `SELECT * FROM _meta_columns WHERE enum_values != ''` 来填充 enumColumns 缓存。
3. **HTTP server 类型断言** — createTable 和 addColumn 的 `as` 断言没有 enumValues 字段，HTTP/CLI 传来的 enumValues 会被静默丢弃。
4. **MCP buildTableSummary** — ENUM 列只显示类型名，AI 看不到允许值。需要改为 `type: ENUM [收入, 支出]`。
5. **TypeScript 类型生成** — ENUM 可以生成联合类型 `"收入" | "支出"` 而非泛 `string`，对开发者更有用。

## 技术决策
| 决策 | 理由 |
|------|------|
| 存储在 _meta_columns 而非新表 | 列元数据已集中在此，加一列最简单 |
| JSON 数组格式 `["a","b","c"]` | 结构化、易解析、支持任意字符串值 |
| 写入验证精确匹配 | 枚举值不应模糊匹配 |
| UI 用逗号分隔输入 | 简单直观，不需要复杂的 tag 组件 |
| enumColumns 缓存结构不同于其他 | 其他缓存只需知道"哪些列是该类型"，ENUM 还需要存允许值列表 |
| importDatabase 后补 ensureSystemSchema | 防止导入旧库后 _meta_columns 不存在导致崩溃 |

## 涉及文件
- `desktop/electron/data-store/types.ts` — 主进程类型
- `desktop/src/types/data-store.ts` — 渲染进程类型
- `desktop/electron/data-store/service.ts` — SQLite service
- `desktop/electron/data-store/channels.ts` — IPC channels
- `desktop/electron/data-store/ipc-handlers.ts` — IPC handlers
- `desktop/electron/data-store/http-server.ts` — HTTP API
- `desktop/electron/preload.ts` — preload bridge
- `desktop/src/types/bridge.ts` — bridge types
- `desktop/src/modules/data-store/hooks/use-data-store.ts` — hooks
- `desktop/src/modules/data-store/components/data-store-column-types.ts` — 类型标签
- `desktop/src/modules/data-store/components/create-table-dialog.tsx` — 建表 UI
- `desktop/src/modules/data-store/components/table-schema-sheet.tsx` — 表结构 UI
- `desktop/src/modules/data-store/components/schema-copy-formats.ts` — 复制格式
- `desktop/src/modules/data-store/components/row-editor.tsx` — 行编辑器（ENUM/BOOLEAN 下拉）
- `desktop/src/modules/data-store/components/data-table-cell-input.tsx` — 单元格输入
- `desktop/src/modules/data-store/index.tsx` — 模块入口
- `desktop/data-store/mcp/index.ts` — MCP server

## 场景走查（第二轮）

### 场景 A：AI 插入非法 ENUM 值 → 错误信息质量
- AI 调 `synapse-data.insert({ table: "ledger", data: { type: "转账" } })`
- Service 验证失败，抛错
- **⚠️ 错误信息必须包含：哪个列、传了什么值、允许哪些值**
- 否则 AI 无法自我纠正，会反复试错
- 示例：`Invalid value "转账" for ENUM column "type". Allowed: 收入, 支出`

### 场景 B：row-editor BOOLEAN 的 "false" 处理
- row-editor 所有值存为字符串，handleSave 的 else 分支：`data[col.name] = raw || null`
- `"false" || null` → `"false"`（字符串 "false" 是 truthy）→ 传到 service → `toBooleanInt("false")` → 0 ✓
- 虽然能工作，但依赖隐式行为。应该显式处理 BOOLEAN 分支。

### 场景 C：row-editor ENUM Select 空选择
- 用户新增行，ENUM 列的 Select 没有选择任何值
- Select value = ""，handleSave else 分支：`"" || null` → null
- Service 收到 null → 跳过 ENUM 验证 → 插入 null ✓
- **但 Select 组件需要一个 placeholder 状态（如"选择..."），否则默认显示第一个选项，用户以为已选**

### 场景 D：row-editor Select 的键盘交互
- 当前 row-editor 的 Enter 键触发 save，Escape 触发 cancel
- Select 组件打开时，Enter 应该选中选项而非触发 save
- **⚠️ 需要区分 Select 打开/关闭状态，只在关闭时 Enter 才触发 save**

### 场景 E：MCP create_table ENUM 缺 enumValues
- AI 调 `synapse-data.create_table({ columns: [{ name: "type", type: "ENUM" }] })`
- 没传 enumValues
- **Service 必须拒绝并给出明确错误：ENUM 类型必须提供 enumValues**

### 场景 F：建表对话框 ENUM 验证
- 用户选了 ENUM 类型但没填枚举值就点创建
- **⚠️ 前端需要校验：ENUM 列的 enumValues 不能为空，否则显示错误提示**

### 场景 G：Skill 上下文中 ENUM 列的呈现
- 复制 Skill 上下文时，ENUM 列应该这样显示：
  ```
  - type (ENUM: 收入/支出) — 交易类型
  ```
- 示例数据应该用第一个枚举值：
  ```
  "type": "收入"
  ```
- ✓ 已在计划中

### 场景 H：MCP describe_table 返回 enumValues
- `describe_table` 返回的 JSON 中，ENUM 列的 `enumValues` 字段是数组
- MCP 响应是 `JSON.stringify(result)`，数组会正确序列化
- AI 能看到 `"enumValues": ["收入", "支出"]` ✓

### 场景 I：修改枚举值后的缓存一致性
- 用户通过 UI 修改枚举值 → `updateColumnEnumValues` → 更新 _meta_columns + 刷新缓存
- 同时 MCP 客户端在插入 → 读取的是旧缓存
- **可接受**：桌面应用单进程，updateColumnEnumValues 是同步更新缓存，下一次 insert 就能看到新值
