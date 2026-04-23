# 任务计划：Data Store 新增 ENUM 列类型

## 目标
用户建表时可选 ENUM 类型，定义允许的值列表；写入时自动验证，AI 通过 MCP 能看到合法选项。

## 当前阶段
阶段 1

## 各阶段

### 阶段 1：数据模型与存储
- [ ] `_meta_columns` 表加 `enum_values` 列（TEXT，存 JSON 数组，如 `["收入","支出"]`）
- [ ] `ensureSystemSchema()` 用 ALTER TABLE 兼容已有数据库
- [ ] `DataStoreColumnType` 加 `"ENUM"`
- [ ] `DataStoreColumnDef` 加 `enumValues?: string[]`
- [ ] `DataStoreColumnInfo` 加 `enumValues: string[]`
- **状态：** pending

### 阶段 2：Service 层
- [ ] `VALID_COLUMN_TYPES` 加 ENUM
- [ ] `createTable`：ENUM 列校验 enumValues 非空，写入 _meta_columns
- [ ] `addColumn`：ENUM 列校验 enumValues 非空，写入 _meta_columns；若有 default 值，校验 default 在 enumValues 中
- [ ] `describeTable`：读取 enum_values 合并到 `DataStoreColumnInfo`
- [ ] 新增 `enumColumns` 缓存（`Map<string, Map<string, string[]>>`，表名→列名→允许值）
- [ ] `refreshJsonColumnCache`：除 PRAGMA 外，额外查 `_meta_columns` 的 `enum_values` 填充 enumColumns
- [ ] `insert` / `batchInsert` / `update`：ENUM 列验证值在允许列表中（null/空跳过），**错误信息含列名+传入值+允许值列表**
- [ ] `buildWhere`：ENUM 列无需特殊转换（TEXT 存储）
- [ ] 新增 `updateColumnEnumValues(table, column, values)` 方法，更新 _meta_columns + 刷新缓存
- [ ] **`importDatabase`：导入后先调 `ensureSystemSchema()` 再 `refreshJsonColumnCache()`**（修复旧库无 _meta_columns 的崩溃）
- **状态：** pending

### 阶段 3：IPC / Bridge / Preload / HTTP / MCP
- [ ] channels 加 `updateColumnEnumValues`
- [ ] ipc-handlers 加 handler
- [ ] bridge types 加方法签名
- [ ] preload 加方法
- [ ] http-server：createTable 类型转换加 `enumValues?: string[]`
- [ ] http-server：addColumn 类型转换加 `enumValues?: string[]`
- [ ] http-server：新增 `updateColumnEnumValues` dispatch case
- [ ] MCP create_table / add_column schema 加 enumValues 字段
- [ ] MCP 新增 update_column_enum_values 工具
- [ ] MCP `buildTableSummary`：ENUM 列显示允许值，如 `type: ENUM [收入, 支出]`
- [ ] MCP insert/update description 提及 ENUM 验证
- **状态：** pending

### 阶段 4：UI — 创建表对话框
- [ ] `data-store-column-types.ts` 加 ENUM 标签（"枚举"）
- [ ] `ColumnRow` 加 `enumValues: string[]`
- [ ] 选择 ENUM 类型时显示值输入区（逗号分隔）
- [ ] **前端校验：ENUM 列的 enumValues 不能为空，否则阻止提交并显示错误**
- [ ] 提交时传 enumValues 到 `DataStoreColumnDef`
- **状态：** pending

### 阶段 5：UI — 表结构 Sheet
- [ ] 说明列显示 ENUM 的允许值
- [ ] 添加列选 ENUM 时可填值列表
- [ ] 已有 ENUM 列可编辑允许值
- **状态：** pending

### 阶段 5.5：UI — 行编辑器适配
- [ ] row-editor：ENUM 列渲染 Select 下拉（选项来自 `col.enumValues`），**含空 placeholder "选择..."**
- [ ] row-editor：BOOLEAN 列渲染 Select 下拉（true/false 两个选项）
- [ ] row-editor `handleSave`：BOOLEAN 列显式转换 "true"→true / "false"→false（不依赖隐式 truthy）
- [ ] row-editor `handleSave`：ENUM 列直接传字符串（已是 TEXT）
- [ ] **Select 键盘交互：Select 打开时 Enter 选中选项，关闭时 Enter 触发 save**
- [ ] 行编辑器 focus 管理：Select 组件不走 inputRefs，需要单独处理
- [ ] data-table-view 非编辑态：BOOLEAN 列显示 ✓/✗ 而非 "true"/"false"
- **状态：** pending

### 阶段 6：Schema 复制格式
- [ ] `sqlType`：ENUM → TEXT
- [ ] `tsType`：ENUM → 联合类型 `"值1" | "值2"`（有 enumValues 时），否则 `string`
- [ ] `generateJSONSchema`：ENUM → { type: "string", enum: [...] }
- [ ] `generateSkillContext`：列描述追加允许值，示例值用第一个枚举值
- [ ] `generateMCPExample`：示例值用第一个枚举值（带引号）
- [ ] `generateMarkdown`：说明列显示允许值
- **状态：** pending

### 阶段 7：验证
- [ ] `pnpm desktop:typecheck` 通过
- [ ] 手动测试建表、插入、复制格式
- **状态：** pending

## 接口能力完整性检查

| 能力 | UI | IPC | HTTP | MCP |
|------|-----|-----|------|-----|
| 建表时指定 ENUM + 选项 | 阶段4 | 阶段3 | 阶段3 | 阶段3 |
| 加列时指定 ENUM + 选项 | 阶段5 | 阶段3 | 阶段3 | 阶段3 |
| 修改已有列的枚举选项 | 阶段5 | 阶段3 | 阶段3 | 阶段3 |
| describe_table 返回枚举选项 | 自动 | 自动 | 自动 | 自动 |
| 插入/更新时验证枚举值 | 阶段5.5 | 阶段2 | 阶段2 | 阶段2 |
| ENUM 列编辑显示下拉选择 | 阶段5.5 | — | — | — |
| BOOLEAN 列编辑显示下拉选择 | 阶段5.5 | — | — | — |

## 边界情况

| 场景 | 处理方式 |
|------|---------|
| 修改枚举选项后已有数据不在新列表中 | 不删数据，仅新写入时验证 |
| ENUM 列允许空值 | null/空字符串不做枚举验证 |
| 枚举选项为空数组 | 建表/加列时校验至少一个选项（前后端都校验） |
| 枚举值包含逗号 | UI 用逗号分隔输入，值本身不能含逗号（简化处理） |
| addColumn ENUM 带 default 值 | 校验 default 在 enumValues 中 |
| rawSQL 绕过验证 | 可接受，rawSQL 是逃生舱 |
| HTTP createTable 类型转换 | 当前 as 断言缺 enumValues，需补上 |
| MCP buildTableSummary | 当前只显示列类型，ENUM 列需追加允许值 |
| BOOLEAN 非编辑态显示 | formatCellValue 把 true/false 显示为文本，改为 ✓/✗ |
| MCP 创建 ENUM 列缺 enumValues | Service 拒绝并报错 "ENUM type requires enumValues" |
| ENUM 验证失败的错误信息 | 必须含列名+传入值+允许值，AI 才能自我纠正 |
| Select 空选择 | placeholder "选择..."，提交时传 null |
| Select 打开时按 Enter | 选中当前选项，不触发 save |

## 关键决策

| 决策 | 理由 |
|------|------|
| ENUM 值存 `_meta_columns.enum_values` (JSON 数组) | 复用已有元数据表，不新建表 |
| SQLite 底层用 TEXT 存储 | ENUM 本质是受限文本，TEXT 最简单 |
| 用 ALTER TABLE ADD COLUMN 迁移 | 兼容已有数据库，不丢数据 |
| 验证区分大小写 | 枚举值精确匹配，避免歧义 |

## 遇到的错误
| 错误 | 尝试次数 | 解决方案 |
|------|---------|---------|
|      | 1       |         |
