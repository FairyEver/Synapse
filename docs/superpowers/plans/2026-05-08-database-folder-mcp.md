# Database Folder MCP Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将数据库文件夹管理功能暴露为 MCP tools，使外部 AI 能通过 MCP 管理 table folders。

**Architecture:** 在现有 Database Service 和 IPC handlers 基础上，补充 capability 定义和 MCP tool schemas。复用现有 folder 方法实现，无需新增业务逻辑。

**Tech Stack:** TypeScript, SQLite, MCP (Model Context Protocol)

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `desktop/database/shared/capability-registry.ts` | 定义 database domain capabilities | 新增 6 条 folder/table move capabilities |
| `desktop/database/shared/mcp-tools.ts` | 定义 MCP tool schemas | 新增 6 个 tool definitions |

---

## Task 1: Add Folder Capabilities

**Files:**
- Modify: `desktop/database/shared/capability-registry.ts:30-32`

**Context:** 现有 DATABASE_CAPABILITIES 数组末尾（line 30）的 `database.sql.execute` 之后，添加 folder 相关 capabilities。

- [ ] **Step 1: Add folder capabilities to registry**

```typescript
// Add after line 30 (database.sql.execute capability):
  { id: "database.folder.list", title: "List folders", description: "List table folders and their members.", mutates: false },
  { id: "database.folder.create", title: "Create folder", description: "Create a table folder.", mutates: true },
  { id: "database.folder.rename", title: "Rename folder", description: "Rename a table folder.", mutates: true },
  { id: "database.folder.delete", title: "Delete folder", description: "Delete a table folder. Tables inside are moved to root.", mutates: true },
  { id: "database.folder.reorder", title: "Reorder folders", description: "Reorder table folders.", mutates: true },
  { id: "database.table.move", title: "Move table", description: "Move a table to a folder or to root.", mutates: true },
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit database/shared/capability-registry.ts
```

Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add desktop/database/shared/capability-registry.ts
git commit -m "feat(database): add folder capabilities to registry

Add 6 new capabilities:
- database.folder.list
- database.folder.create
- database.folder.rename
- database.folder.delete
- database.folder.reorder
- database.table.move"
```

---

## Task 2: Add MCP Tool Definitions

**Files:**
- Modify: `desktop/database/shared/mcp-tools.ts:490-491` (在 `buildTools()` 函数返回数组末尾，database_sql_execute 之后)

**Context:** 在 buildTools() 函数中，database_sql_execute tool 之后添加 folder tools。

- [ ] **Step 1: Add folder_list tool**

```typescript
// Add after database_sql_execute (line 489), before the closing bracket:
    {
      name: "database_folder_list",
      description: "List all table folders and their members. Returns an array of { id, name, sortOrder, members: [{ tableName, sortOrder }] }.",
      inputSchema: { type: "object", properties: {} },
    },
```

- [ ] **Step 2: Add folder_create tool**

```typescript
    {
      name: "database_folder_create",
      description: "Create a table folder. Folder names must be unique and non-empty.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Folder name. Must be unique and non-empty.",
          },
        },
        required: ["name"],
      },
    },
```

- [ ] **Step 3: Add folder_rename tool**

```typescript
    {
      name: "database_folder_rename",
      description: "Rename a table folder. The new name must be unique and non-empty.",
      inputSchema: {
        type: "object",
        properties: {
          folderId: {
            type: "number",
            description: "Folder id",
          },
          name: {
            type: "string",
            description: "New folder name. Must be unique and non-empty.",
          },
        },
        required: ["folderId", "name"],
      },
    },
```

- [ ] **Step 4: Add folder_delete tool**

```typescript
    {
      name: "database_folder_delete",
      description: "Delete a table folder. Tables inside the folder are moved to root (no longer in any folder).",
      inputSchema: {
        type: "object",
        properties: {
          folderId: {
            type: "number",
            description: "Folder id",
          },
        },
        required: ["folderId"],
      },
    },
```

- [ ] **Step 5: Add folder_reorder tool**

```typescript
    {
      name: "database_folder_reorder",
      description: "Reorder table folders. Pass folderIds in the desired order.",
      inputSchema: {
        type: "object",
        properties: {
          folderIds: {
            type: "array",
            items: { type: "number" },
            description: "Folder ids in desired order",
          },
        },
        required: ["folderIds"],
      },
    },
```

- [ ] **Step 6: Add table_move tool**

```typescript
    {
      name: "database_table_move",
      description: "Move a table to a folder or to root. Call database_folder_list to see available folders. Omit folderId to move table to root (no folder).",
      inputSchema: {
        type: "object",
        properties: {
          tableName: {
            type: "string",
            description: "Existing table name. If the user did not provide an exact table name, call database_table_list first.",
          },
          folderId: {
            type: "number",
            description: "Optional folder id. Omit to move table to root (no folder).",
          },
        },
        required: ["tableName"],
      },
    },
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit database/shared/mcp-tools.ts
```

Expected: 无错误

- [ ] **Step 8: Commit**

```bash
git add desktop/database/shared/mcp-tools.ts
git commit -m "feat(database): add folder MCP tool definitions

Add 6 new MCP tools:
- database_folder_list
- database_folder_create
- database_folder_rename
- database_folder_delete
- database_folder_reorder
- database_table_move"
```

---

## Task 3: Verify Implementation

**Files:**
- Test: `desktop/tests/unit/database-capability-parity.test.ts`

**Context:** 该测试自动验证 MCP tool 与 capability 的一一对应关系。

- [ ] **Step 1: Run parity test**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && npx vitest run tests/unit/database-capability-parity.test.ts
```

Expected: 所有测试通过

- [ ] **Step 2: Run MCP tools test**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && npx vitest run tests/unit/database-mcp-tools.test.ts
```

Expected: 所有测试通过

- [ ] **Step 3: Verify tool names match convention**

检查输出中应包含新 tool 名称：
- `database_folder_list`
- `database_folder_create`
- `database_folder_rename`
- `database_folder_delete`
- `database_folder_reorder`
- `database_table_move`

- [ ] **Step 4: Commit (if tests pass)**

```bash
git commit --allow-empty -m "test: verify folder MCP tools parity

All capability parity tests passing for new folder tools."
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] `database_folder_list` → Task 2 Step 1
- [x] `database_folder_create` → Task 2 Step 2
- [x] `database_folder_rename` → Task 2 Step 3
- [x] `database_folder_delete` → Task 2 Step 4
- [x] `database_folder_reorder` → Task 2 Step 5
- [x] `database_table_move` → Task 2 Step 6

**No placeholders:**
- [x] 所有步骤包含实际代码
- [x] 所有步骤包含验证命令
- [x] 无 "TBD"/"TODO"

**Type consistency:**
- [x] 使用 `folderId`（与现有 `rowId` 一致）
- [x] 使用 `tableName`（与现有参数一致）
- [x] Tool 命名遵循 `database_[entity]_[action]` 模式

---

## Execution Options

**Plan complete and saved to `docs/superpowers/plans/2026-05-08-database-folder-mcp.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints for review

**Which approach?**
