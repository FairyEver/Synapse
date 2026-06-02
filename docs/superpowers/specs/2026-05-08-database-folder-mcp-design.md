# Database Folder MCP Tools 设计文档

**日期**: 2026-05-08  
**主题**: 将数据库侧边栏的文件夹管理功能暴露给 MCP

## 背景

Synapse 桌面应用的数据库侧边栏支持文件夹和表的层级管理。目前已有完整的 folder service 实现和 IPC handlers，但缺少 MCP 层暴露，外部 AI 无法通过 MCP 调用这些功能。

## 目标

将以下功能暴露为 MCP tools：
- 查询文件夹列表及其包含的表
- 创建、重命名、删除文件夹
- 将表移入/移出文件夹
- 调整文件夹和表的排序

## 设计决策

### 1. 工具命名遵循现有规律

现有 MCP tool 命名模式：`[domain]_[entity]_[action]`

- `database_table_rename`
- `database_column_update`
- `database_row_delete`

Folder 相关工具延续此模式：
- `database_folder_*` 操作 folder 实体
- `database_table_move` 操作 table 实体（与 `database_table_rename` 并列）

### 2. 参数命名遵循现有规律

现有参数使用 camelCase：
- `tableName`, `columnName`, `rowId`
- `fromTableName`, `toTableName`

Folder 工具参数：
- `folderId` - 与 `rowId` 保持一致
- `folderIds` - 数组形式用于批量排序

### 3. 删除非空文件夹的行为

与 UI 行为保持一致：删除 folder 时，内部 tables 自动移到 root（不再属于任何 folder）。

底层实现：`folderDelete` 使用 SQL `ON DELETE CASCADE` 删除 `_table_folder_members` 记录，tables 本身不受影响。

### 4. 表移动的语义

`database_table_move` 参数设计：
```typescript
{ tableName: string, folderId?: number }
```
- 传入 `folderId` → 移入指定 folder
- 不传 `folderId` → 移到 root（不属于任何 folder）

### 5. 列表返回格式

`database_folder_list` 返回嵌套结构，一次调用获取完整视图：
```typescript
{
  id: number;
  name: string;
  sortOrder: number;
  members: { tableName: string; sortOrder: number }[]
}[]
```

## 工具清单

### database_folder_list
- **功能**: 列出所有文件夹及其包含的表
- **输入**: 无
- **返回**: `Folder[]`，每个 folder 包含其 members

### database_folder_create
- **功能**: 创建新文件夹
- **输入**: `{ name: string }`
- **返回**: `{ id: number }`
- **边界**: name 会 trim，空字符串报错；自动分配最大 sortOrder

### database_folder_rename
- **功能**: 重命名文件夹
- **输入**: `{ folderId: number, name: string }`
- **返回**: 无
- **边界**: name 会 trim，空字符串报错；folder 不存在报错

### database_folder_delete
- **功能**: 删除文件夹，内部表移到 root
- **输入**: `{ folderId: number }`
- **返回**: 无
- **边界**: folder 不存在报错；非空 folder 可删除，tables 移到 root

### database_folder_reorder
- **功能**: 调整文件夹顺序
- **输入**: `{ folderIds: number[] }`
- **返回**: 无
- **说明**: 按数组索引设置 sortOrder

### database_table_move
- **功能**: 将表移入文件夹或移到 root
- **输入**: `{ tableName: string, folderId?: number }`
- **返回**: 无
- **边界**: table 不存在时报错；folder 不存在报错；失败时不得先删除已有 folder membership

## 与现有代码映射

| MCP Tool | Service 方法 | IPC Handler | 状态 |
|----------|-------------|-------------|------|
| database_folder_list | `folderList()` | 已存在 | 需新增 capability + tool |
| database_folder_create | `folderCreate(name)` | 已存在 | 需新增 capability + tool |
| database_folder_rename | `folderRename(id, name)` | 已存在 | 需新增 capability + tool |
| database_folder_delete | `folderDelete(id)` | 已存在 | 需新增 capability + tool |
| database_folder_reorder | `folderReorderFolders(folderIds[])` | 已存在 | 需新增 capability + tool |
| database_table_move | `folderMoveTable(tableName, folderId)` | 已存在 | 需新增 capability + tool |

## 错误处理

所有工具复用现有 service 层的错误处理：
- folder 不存在 → `Error('Folder not found: ${id}')`
- 空名称 → `Error('Folder name cannot be empty')`
- table 不存在 → `Error('Table "${name}" not found')`
- table/folder 不存在时的操作 → service 层在写入 folder membership 前阻断

## 实现范围

**需要修改的文件：**
1. `desktop/database/shared/capability-registry.ts` - 新增 6 条 capabilities
2. `desktop/database/shared/mcp-tools.ts` - 新增 6 个 tool definitions

**不需要修改的文件：**
- `desktop/database/service.ts` - folder 方法已完整实现
- `desktop/database/ipc-handlers.ts` - IPC handlers 已存在
- `desktop/database/mcp-server.ts` - 通过 action router 自动映射

## 测试策略

复用现有的 capability parity test：`tests/unit/database-capability-parity.test.ts`

该测试会验证：
- MCP tool 与 capability 一一对应
- Tool name 与 action ID 映射正确
