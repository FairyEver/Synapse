# Synapse 代码结构性优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Synapse 桌面应用的大文件拆分为职责单一的模块，统一验证和错误处理模式，提升代码可维护性。

**Architecture:** 由内而外三阶段 — 先建共享基础设施（schema 库），再拆主进程 god files（database/service.ts、agent-runtime-service.ts），最后拆渲染进程大组件（content-browser-page、use-agent-chat）。每个拆分保持 facade 模式，外部 API 不变。

**Tech Stack:** TypeScript 6, Zod, React 19 (useReducer), Electron IPC

---

## Phase 1: 基础设施层

### Task 1: 提取共享 IPC Schema 库

**Files:**
- Create: `desktop/electron/runtime/ipc/schemas.ts`
- Modify: `desktop/electron/modules/agent/ipc.ts:24-28`
- Modify: `desktop/electron/modules/connectors/ipc.ts` (projectRequestSchema definition)
- Modify: `desktop/electron/modules/ops/ipc.ts` (projectRequestSchema definition)

- [ ] **Step 1: 创建共享 schema 文件**

```typescript
// desktop/electron/runtime/ipc/schemas.ts
import { z } from "zod"

export const projectRequestSchema = z.object({
  projectId: z.string().min(1),
})

export const paginationSchema = z.object({
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
})

export const repositoryUuidSchema = z.object({
  repositoryUuid: z.string().min(1),
})
```

- [ ] **Step 2: 更新 agent 模块引用**

在 `desktop/electron/modules/agent/ipc.ts` 中，删除本地 `projectRequestSchema` 定义（约 line 24-26），替换为：

```typescript
import { projectRequestSchema } from "../../runtime/ipc/schemas"
```

保留所有 `.extend()` 调用不变。

- [ ] **Step 3: 更新 connectors 模块引用**

在 `desktop/electron/modules/connectors/ipc.ts` 中，删除本地 `projectRequestSchema` 定义，替换为：

```typescript
import { projectRequestSchema } from "../../runtime/ipc/schemas"
```

- [ ] **Step 4: 更新 ops 模块引用**

在 `desktop/electron/modules/ops/ipc.ts` 中，删除本地 `projectRequestSchema` 定义，替换为：

```typescript
import { projectRequestSchema } from "../../runtime/ipc/schemas"
```

- [ ] **Step 5: 验证编译通过**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/runtime/ipc/schemas.ts desktop/electron/modules/agent/ipc.ts desktop/electron/modules/connectors/ipc.ts desktop/electron/modules/ops/ipc.ts
git commit -m "refactor: extract shared IPC schemas to eliminate duplication"
```

---

### Task 2: 审查并修正静默错误处理

**Files:**
- Modify: 涉及静默吞错的文件（逐个审查）

- [ ] **Step 1: 定位所有静默吞错**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && grep -rn "\.catch(() =>" electron/ src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "\.catch(() => null)"`

审查每一处，判断是否合理。文件存在性检查的 `.catch(() => null)` 保留不动。

- [ ] **Step 2: 修正不合理的静默吞错**

对于每处不合理的静默吞错，改为带日志的处理：

```typescript
// Before:
somePromise.catch(() => {})

// After:
somePromise.catch((error) => {
  logger.warn("Description of what failed", { error })
})
```

- [ ] **Step 3: 验证编译通过**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "refactor: replace silent error swallowing with logged warnings"
```

---
## Phase 2: 主进程大文件拆分

### Task 3: 拆分 database/service.ts — 提取 type-coercion.ts

**Files:**
- Create: `desktop/electron/database/type-coercion.ts`
- Modify: `desktop/electron/database/service.ts:1008-1031`

- [ ] **Step 1: 创建 type-coercion.ts**

从 `service.ts` 提取类型转换逻辑（`convertWriteValue` 及相关的列类型查询方法）：

```typescript
// desktop/electron/database/type-coercion.ts
import type { ColumnKind } from "./column-kind"

export interface ColumnMetaEntry {
  kind: ColumnKind
  choices?: string[]
}

export type ColumnMetaMap = Map<string, ColumnMetaEntry>

export function getJsonColumns(meta: ColumnMetaMap): string[] {
  return [...meta.entries()].filter(([, m]) => m.kind === "json").map(([name]) => name)
}

export function getBooleanColumns(meta: ColumnMetaMap): string[] {
  return [...meta.entries()].filter(([, m]) => m.kind === "boolean").map(([name]) => name)
}

export function getDateColumns(meta: ColumnMetaMap): string[] {
  return [...meta.entries()].filter(([, m]) => m.kind === "date").map(([name]) => name)
}

export function getTimestampColumns(meta: ColumnMetaMap): string[] {
  return [...meta.entries()].filter(([, m]) => m.kind === "timestamp").map(([name]) => name)
}

export function getNumericColumns(meta: ColumnMetaMap): string[] {
  return [...meta.entries()].filter(([, m]) => m.kind === "integer" || m.kind === "decimal").map(([name]) => name)
}

export function getChoiceColumns(meta: ColumnMetaMap): Array<{ name: string; choices: string[] }> {
  return [...meta.entries()]
    .filter(([, m]) => m.kind === "single_choice" && m.choices)
    .map(([name, m]) => ({ name, choices: m.choices! }))
}

export function getMultiChoiceColumns(meta: ColumnMetaMap): Array<{ name: string; choices: string[] }> {
  return [...meta.entries()]
    .filter(([, m]) => m.kind === "multi_choice" && m.choices)
    .map(([name, m]) => ({ name, choices: m.choices! }))
}

export function convertWriteValue(
  column: string,
  value: unknown,
  meta: ColumnMetaMap,
): unknown {
  const entry = meta.get(column)
  if (!entry) return value

  switch (entry.kind) {
    case "json":
      return value != null ? JSON.stringify(value) : null
    case "boolean":
      return value === true ? 1 : value === false ? 0 : value
    case "multi_choice":
      return Array.isArray(value) ? JSON.stringify(value) : value
    case "integer":
      return value != null ? Math.trunc(Number(value)) : null
    case "decimal":
      return value != null ? Number(value) : null
    default:
      return value
  }
}

export function parseReadValue(
  column: string,
  value: unknown,
  meta: ColumnMetaMap,
): unknown {
  const entry = meta.get(column)
  if (!entry || value == null) return value

  switch (entry.kind) {
    case "json":
    case "multi_choice":
      return typeof value === "string" ? JSON.parse(value) : value
    case "boolean":
      return value === 1 ? true : value === 0 ? false : value
    default:
      return value
  }
}
```

- [ ] **Step 2: 在 service.ts 中引用 type-coercion**

替换 `service.ts` 中的 `convertWriteValue`、列类型查询方法为 import 调用。保留 `columnMeta` 缓存在 service 中，传入函数。

- [ ] **Step 3: 验证编译通过**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit`

- [ ] **Step 4: 运行现有测试**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx vitest run electron/database/__tests__/`
Expected: 所有测试通过

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/database/type-coercion.ts desktop/electron/database/service.ts
git commit -m "refactor(database): extract type coercion to dedicated module"
```

---

### Task 4: 拆分 database/service.ts — 提取 query-builder.ts

**Files:**
- Create: `desktop/electron/database/query-builder.ts`
- Modify: `desktop/electron/database/service.ts:2171-2258`

- [ ] **Step 1: 创建 query-builder.ts**

从 `service.ts` 提取 `buildWhere`（line 2171）和 `buildOrderBy`（line 2246）：

```typescript
// desktop/electron/database/query-builder.ts
import type { SQLInputValue } from "node:sqlite"
import type { ColumnMetaMap } from "./type-coercion"
import type { DatabaseWhereClause, DatabaseOrderBy } from "./types"
import { getJsonColumns, getBooleanColumns, getMultiChoiceColumns } from "./type-coercion"

export interface WhereResult {
  clause: string
  params: SQLInputValue[]
}

export function buildWhere(
  where: DatabaseWhereClause | undefined,
  tableMeta: ColumnMetaMap,
): WhereResult {
  if (!where) return { clause: "", params: [] }

  // Implementation extracted from service.ts lines 2171-2244
  // Handles: equality objects, condition arrays, grouped conditions (all/any)
  // Special handling for JSON, boolean, multi_choice columns
  // ... (exact implementation from current service.ts)
}

export function buildOrderBy(
  orderBy: DatabaseOrderBy | undefined,
  tableName: string,
): string {
  if (!orderBy) return ""

  if (typeof orderBy === "string") {
    return ` ORDER BY "${orderBy}" ASC`
  }
  const dir = orderBy.dir === "desc" ? "DESC" : "ASC"
  return ` ORDER BY "${orderBy.field}" ${dir}`
}
```

- [ ] **Step 2: 在 service.ts 中替换为 import 调用**

删除 `service.ts` 中的 `buildWhere` 和 `buildOrderBy` 方法，改为：

```typescript
import { buildWhere, buildOrderBy } from "./query-builder"
```

在 `databaseRowList`、`databaseRowsUpdate`、`databaseRowsDelete`、`databaseRowCount` 中调用时传入 `this.getColumnMetaForTable(tableName)`。

- [ ] **Step 3: 验证编译 + 测试**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit && npx vitest run electron/database/__tests__/`

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/database/query-builder.ts desktop/electron/database/service.ts
git commit -m "refactor(database): extract query builder to dedicated module"
```

---

### Task 5: 拆分 database/service.ts — 提取 validators.ts

**Files:**
- Create: `desktop/electron/database/validators.ts`
- Modify: `desktop/electron/database/service.ts:983-1040`

- [ ] **Step 1: 创建 validators.ts**

提取验证逻辑：

```typescript
// desktop/electron/database/validators.ts
import type { ColumnMetaMap } from "./type-coercion"

const RESERVED_COLUMNS = new Set(["id", "created_at", "updated_at"])
const TABLE_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*$/
const COLUMN_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*$/

export function validateTableName(name: string): void {
  if (!TABLE_NAME_REGEX.test(name)) {
    throw new Error(`Table name "${name}" must start with a letter and contain only letters, digits, or underscores.`)
  }
  if (name.startsWith("_")) {
    throw new Error(`Table name "${name}" cannot start with underscore.`)
  }
}

export function validateColumnName(name: string): void {
  if (!COLUMN_NAME_REGEX.test(name)) {
    throw new Error(`Column name "${name}" must start with a letter and contain only letters, digits, or underscores.`)
  }
  if (name.startsWith("_")) {
    throw new Error(`Column name "${name}" cannot start with underscore.`)
  }
  if (RESERVED_COLUMNS.has(name)) {
    throw new Error(`Column name "${name}" is reserved.`)
  }
}

export function validateSingleChoiceValue(
  column: string,
  value: unknown,
  choices: string[],
): void {
  if (value != null && !choices.includes(String(value))) {
    throw new Error(`Value "${value}" is not a valid choice for column "${column}". Valid: ${choices.join(", ")}`)
  }
}

export function validateMultiChoiceValue(
  column: string,
  value: unknown,
  choices: string[],
): void {
  if (!Array.isArray(value)) {
    throw new Error(`Column "${column}" expects an array of choices.`)
  }
  for (const item of value) {
    if (!choices.includes(String(item))) {
      throw new Error(`Value "${item}" is not a valid choice for column "${column}". Valid: ${choices.join(", ")}`)
    }
  }
}
```

- [ ] **Step 2: 在 service.ts 中替换为 import 调用**

- [ ] **Step 3: 验证编译 + 测试**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit && npx vitest run electron/database/__tests__/`

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/database/validators.ts desktop/electron/database/service.ts
git commit -m "refactor(database): extract validators to dedicated module"
```

---

### Task 6: 拆分 database/service.ts — 提取 schema-manager.ts

**Files:**
- Create: `desktop/electron/database/schema-manager.ts`
- Modify: `desktop/electron/database/service.ts:1042-1877`

- [ ] **Step 1: 创建 schema-manager.ts**

提取表/列 CRUD 操作。这是最大的一块，包含：
- `databaseTableList`, `databaseTableCreate`, `databaseTableDelete`, `databaseTableDescribe`, `databaseTableUpdate`, `databaseTableRename`
- `databaseColumnCreate`, `databaseColumnUpdate`, `databaseColumnRename`, `databaseColumnDelete`
- `databaseChoiceUsageGet`, `databaseChoiceUpdate`

```typescript
// desktop/electron/database/schema-manager.ts
import type { DatabaseSync } from "node:sqlite"
import type { ColumnMetaMap } from "./type-coercion"
import { validateTableName, validateColumnName, validateSingleChoiceValue, validateMultiChoiceValue } from "./validators"
// ... type imports

export class SchemaManager {
  constructor(
    private getDb: () => DatabaseSync,
    private getColumnMeta: (table: string) => ColumnMetaMap,
    private refreshColumnMetaCache: () => void,
    private recordOperation: (op: string, table: string, details?: Record<string, unknown>) => void,
  ) {}

  // All table/column CRUD methods moved here
  // Each method receives db via this.getDb() instead of this.db
}
```

- [ ] **Step 2: 在 service.ts 中实例化 SchemaManager 并委托调用**

```typescript
// In DatabaseService constructor/open:
this.schemaManager = new SchemaManager(
  () => this.getDb(),
  (table) => this.getColumnMetaForTable(table),
  () => this.refreshColumnMetaCache(),
  (op, table, details) => this.recordOperation(op, table, details),
)

// Public methods delegate:
databaseTableList() { return this.schemaManager.databaseTableList() }
databaseTableCreate(input) { return this.schemaManager.databaseTableCreate(input) }
// ...
```

- [ ] **Step 3: 验证编译 + 测试**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit && npx vitest run electron/database/__tests__/`

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/database/schema-manager.ts desktop/electron/database/service.ts
git commit -m "refactor(database): extract schema manager to dedicated module"
```

---

### Task 7: 拆分 database/service.ts — 提取 import-export.ts

**Files:**
- Create: `desktop/electron/database/import-export.ts`
- Modify: `desktop/electron/database/service.ts:1914-2147`

- [ ] **Step 1: 创建 import-export.ts**

提取导入导出逻辑（`exportDatabase`, `importDatabase`, `exportTable`, `importTable`, `inspectTableImport` 及所有 `buildExport*` 辅助方法）：

```typescript
// desktop/electron/database/import-export.ts
import type { DatabaseSync } from "node:sqlite"
import type { ColumnMetaMap } from "./type-coercion"

export class ImportExportManager {
  constructor(
    private getDb: () => DatabaseSync,
    private getDbPath: () => string,
    private getColumnMeta: (table: string) => ColumnMetaMap,
    private refreshColumnMetaCache: () => void,
  ) {}

  async exportDatabase(): Promise<string> { /* ... */ }
  async importDatabase(sourcePath: string): Promise<void> { /* ... */ }
  exportTable(tableName: string): string { /* ... */ }
  inspectTableImport(filePath: string): unknown { /* ... */ }
  importTable(filePath: string, options?: { overwrite?: boolean }): void { /* ... */ }

  private readTableExportPayload(filePath: string): unknown { /* ... */ }
  private tableExists(name: string): boolean { /* ... */ }
  private buildExportCreateTableSql(tableName: string): string { /* ... */ }
  private buildExportSystemSchemaSql(tableName: string): string { /* ... */ }
  private buildExportMetaTableSql(tableName: string): string { /* ... */ }
  private buildExportMetaColumnSql(tableName: string): string { /* ... */ }
  private buildExportInsertSql(tableName: string): string { /* ... */ }
  private replaceTableFromExport(payload: unknown): void { /* ... */ }
  private validateImportedColumns(columns: unknown[]): void { /* ... */ }
}
```

- [ ] **Step 2: 在 service.ts 中委托调用**

- [ ] **Step 3: 验证编译 + 测试**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit && npx vitest run electron/database/__tests__/`

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/database/import-export.ts desktop/electron/database/service.ts
git commit -m "refactor(database): extract import/export to dedicated module"
```

---

### Task 8: 验证 database/service.ts 瘦身结果

**Files:**
- Verify: `desktop/electron/database/service.ts`

- [ ] **Step 1: 确认行数**

Run: `wc -l /Users/liyang/Documents/code/github/Synapse/desktop/electron/database/service.ts`
Expected: < 800 行（lifecycle + row CRUD + raw SQL + operation log + legacy migration）

- [ ] **Step 2: 确认所有子模块行数**

Run: `wc -l /Users/liyang/Documents/code/github/Synapse/desktop/electron/database/{type-coercion,query-builder,validators,schema-manager,import-export}.ts`
Expected: 每个 < 300 行

- [ ] **Step 3: 运行完整测试**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx vitest run electron/database/__tests__/`
Expected: 全部通过

---
### Task 9: 拆分 agent-runtime-service.ts — 提取 session-manager.ts

**Files:**
- Create: `desktop/electron/services/agent-runtime/session-manager.ts`
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`

- [ ] **Step 1: 创建 session-manager.ts**

提取会话生命周期管理方法（lines 361-583, 1244-1289）：

```typescript
// desktop/electron/services/agent-runtime/session-manager.ts
import type { AgentSessionRepository } from "./session-repository"
import type { RuntimeSessionState } from "./types"

export class SessionManager {
  private states = new Map<string, RuntimeSessionState>()

  constructor(
    private repository: AgentSessionRepository,
  ) {}

  async listSessions(projectIds: string[], historyLimit?: number) { /* ... */ }
  async getSession(conversationId: string) { /* ... */ }
  async createSession(projectId: string, options?: { name?: string; agentType?: string; sessionKey?: string }) { /* ... */ }
  async switchSession(sessionKey: string, conversationId: string) { /* ... */ }
  async renameSession(conversationId: string, name: string) { /* ... */ }
  async deleteSession(conversationId: string) { /* ... */ }
  async clearCurrentAgentSessionId(sessionKey: string) { /* ... */ }
  async resetSession(sessionKey: string, projectId: string) { /* ... */ }

  stateForConversation(conversationId: string): RuntimeSessionState { /* ... */ }
  closeIdleStateForConversation(conversationId: string): void { /* ... */ }
  async reclaimIdleSessions(maxIdleMs: number): Promise<void> { /* ... */ }
}
```

- [ ] **Step 2: 在 agent-runtime-service.ts 中引用 SessionManager**

实例化 `SessionManager` 并将会话相关方法委托给它。保留 `send()`、`processQueue()`、`processTurn()` 等消息路由逻辑在主文件。

- [ ] **Step 3: 验证编译通过**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/services/agent-runtime/session-manager.ts desktop/electron/services/agent-runtime/agent-runtime-service.ts
git commit -m "refactor(agent-runtime): extract session manager"
```

---

### Task 10: 拆分 agent-runtime-service.ts — 提取 message-router.ts

**Files:**
- Create: `desktop/electron/services/agent-runtime/message-router.ts`
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`

- [ ] **Step 1: 创建 message-router.ts**

提取消息路由和队列处理逻辑（lines 170-212, 585-881）：

```typescript
// desktop/electron/services/agent-runtime/message-router.ts
import type { AgentRuntimeServiceDeps, QueuedTurn, RuntimeSessionState } from "./types"
import type { SessionManager } from "./session-manager"

export class MessageRouter {
  constructor(
    private deps: AgentRuntimeServiceDeps,
    private sessionManager: SessionManager,
    private resolveAdapter: (agentType: string) => Promise<AgentAdapter>,
  ) {}

  async send(projectId: string, message: string, options?: SendOptions): Promise<void> { /* ... */ }
  async sendNewSession(projectId: string, message: string, options?: SendOptions): Promise<void> { /* ... */ }
  async sendSideSessionWithTimeout(params: SideSessionParams): Promise<SideSessionResult> { /* ... */ }

  private async processQueue(conversationId: string): Promise<void> { /* ... */ }
  private async processTurn(turn: QueuedTurn, state: RuntimeSessionState): Promise<void> { /* ... */ }
  private async processExecTurn(turn: QueuedTurn): Promise<void> { /* ... */ }
  private async processLiveTurn(turn: QueuedTurn, state: RuntimeSessionState): Promise<void> { /* ... */ }
  private async getLiveSession(conversationId: string, state: RuntimeSessionState): Promise<LiveSession> { /* ... */ }
}
```

- [ ] **Step 2: 在 agent-runtime-service.ts 中委托消息路由**

- [ ] **Step 3: 验证编译通过**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/services/agent-runtime/message-router.ts desktop/electron/services/agent-runtime/agent-runtime-service.ts
git commit -m "refactor(agent-runtime): extract message router"
```

---

### Task 11: 拆分 agent-runtime-service.ts — 提取 compression-manager.ts

**Files:**
- Create: `desktop/electron/services/agent-runtime/compression-manager.ts`
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`

- [ ] **Step 1: 创建 compression-manager.ts**

提取压缩相关逻辑（lines 1395-1590）：

```typescript
// desktop/electron/services/agent-runtime/compression-manager.ts
export class CompressionManager {
  constructor(
    private deps: Pick<AgentRuntimeServiceDeps, "dataRepo" | "eventBus">,
  ) {}

  async getCompressionState(agentType: string): Promise<CompressionState> { /* ... */ }
  async updateCompressionState(agentType: string, state: Partial<CompressionState>): Promise<void> { /* ... */ }
  async compressSession(conversationId: string, liveSession: LiveSession): Promise<void> { /* ... */ }
  async maybeAutoCompress(conversationId: string, tokenCount: number, liveSession: LiveSession): Promise<void> { /* ... */ }

  private async runCompression(liveSession: LiveSession, command: string): Promise<void> { /* ... */ }
  private async getOrCreateCompressionState(agentType: string): Promise<CompressionState> { /* ... */ }
  private async markCompressionState(agentType: string, status: string, error?: string): Promise<void> { /* ... */ }
}
```

- [ ] **Step 2: 在 agent-runtime-service.ts 中委托压缩逻辑**

- [ ] **Step 3: 验证编译通过**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/services/agent-runtime/compression-manager.ts desktop/electron/services/agent-runtime/agent-runtime-service.ts
git commit -m "refactor(agent-runtime): extract compression manager"
```

---

### Task 12: 拆分 agent-runtime-service.ts — 提取 permission-handler.ts

**Files:**
- Create: `desktop/electron/services/agent-runtime/permission-handler.ts`
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`

- [ ] **Step 1: 创建 permission-handler.ts**

提取权限处理逻辑（lines 406-475, 1066-1093, 1218）：

```typescript
// desktop/electron/services/agent-runtime/permission-handler.ts
export class PermissionHandler {
  private pendingPermissions = new Map<string, PendingPermissionState>()

  constructor(
    private deps: Pick<AgentRuntimeServiceDeps, "eventBus" | "auditSink">,
  ) {}

  async respondPermission(permissionId: string, response: PermissionResponse): Promise<void> { /* ... */ }
  async awaitPendingPermission(permissionId: string, timeoutMs: number): Promise<PermissionResponse> { /* ... */ }
  recordPermissionAudit(decision: PermissionDecision): void { /* ... */ }
  getPendingPermissions(): PendingPermissionState[] { /* ... */ }
}
```

- [ ] **Step 2: 在 agent-runtime-service.ts 中委托权限处理**

- [ ] **Step 3: 验证编译通过**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/services/agent-runtime/permission-handler.ts desktop/electron/services/agent-runtime/agent-runtime-service.ts
git commit -m "refactor(agent-runtime): extract permission handler"
```

---

### Task 13: 验证 agent-runtime-service.ts 瘦身结果

**Files:**
- Verify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`

- [ ] **Step 1: 确认行数**

Run: `wc -l /Users/liyang/Documents/code/github/Synapse/desktop/electron/services/agent-runtime/agent-runtime-service.ts`
Expected: < 600 行（编排层 + 事件发射 + 适配器解析）

- [ ] **Step 2: 确认所有子模块行数**

Run: `wc -l /Users/liyang/Documents/code/github/Synapse/desktop/electron/services/agent-runtime/{session-manager,message-router,compression-manager,permission-handler}.ts`
Expected: 每个 < 300 行

- [ ] **Step 3: 运行完整编译**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit`
Expected: 无错误

---

### Task 14: 拆分 modules/agent/ipc.ts（850 行）

**Files:**
- Create: `desktop/electron/modules/agent/ipc-sessions.ts`
- Create: `desktop/electron/modules/agent/ipc-messages.ts`
- Create: `desktop/electron/modules/agent/ipc-tools.ts`
- Modify: `desktop/electron/modules/agent/ipc.ts`

- [ ] **Step 1: 按子领域拆分 handler 定义**

将 `ipc.ts` 中的 handler 按领域分组：
- `ipc-sessions.ts`: listSessions, createSession, switchSession, deleteSession, renameSession
- `ipc-messages.ts`: send, sendNewSession, getTimeline, respondPermission
- `ipc-tools.ts`: listPublishedCommands, openReference, getCompressionState, updateCompressionState

每个文件导出一个 handler 注册函数：

```typescript
// desktop/electron/modules/agent/ipc-sessions.ts
import { projectRequestSchema } from "../../runtime/ipc/schemas"

export function registerSessionHandlers(registry: IpcRegistry, service: AgentRuntimeService) {
  // handler definitions for session operations
}
```

- [ ] **Step 2: 主 ipc.ts 作为聚合入口**

```typescript
// desktop/electron/modules/agent/ipc.ts
import { registerSessionHandlers } from "./ipc-sessions"
import { registerMessageHandlers } from "./ipc-messages"
import { registerToolHandlers } from "./ipc-tools"

export function registerAgentHandlers(registry: IpcRegistry, service: AgentRuntimeService) {
  registerSessionHandlers(registry, service)
  registerMessageHandlers(registry, service)
  registerToolHandlers(registry, service)
}
```

- [ ] **Step 3: 验证编译通过**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/modules/agent/
git commit -m "refactor(agent-ipc): split into session/message/tool handlers"
```

---
## Phase 3: 渲染进程拆分

### Task 15: 拆分 use-agent-chat.ts — 创建 reducer

**Files:**
- Create: `desktop/src/modules/agent/hooks/use-chat-reducer.ts`
- Modify: `desktop/src/modules/agent/hooks/use-agent-chat.ts`

- [ ] **Step 1: 定义 state 和 action 类型**

```typescript
// desktop/src/modules/agent/hooks/use-chat-reducer.ts
import type {
  SynapseAgentSessionSummary,
  SynapseAgentTimelineItem,
  SynapseAgentPendingPermission,
  SynapseAgentStatus,
  SynapseAgentProviderState,
  SynapseAgentPublishedCommand,
} from "@/types/agent"

export interface ChatState {
  sessions: SynapseAgentSessionSummary[]
  archivedSessions: SynapseAgentSessionSummary[]
  timeline: SynapseAgentTimelineItem[]
  pendingPermissions: SynapseAgentPendingPermission[]
  status: SynapseAgentStatus | null
  providers: SynapseAgentProviderState | null
  commands: SynapseAgentPublishedCommand[]
  followFeishu: boolean
  unreadByConversationId: Record<string, number>
  selectedProjectId: string | undefined
  selectedConversationId: string | undefined
  selectedSessionKey: string
  loading: boolean
  sendingConversationIds: Set<string>
  error: string | null
}

export type ChatAction =
  | { type: "SET_SESSIONS"; sessions: SynapseAgentSessionSummary[] }
  | { type: "SET_ARCHIVED_SESSIONS"; sessions: SynapseAgentSessionSummary[] }
  | { type: "SET_TIMELINE"; timeline: SynapseAgentTimelineItem[] }
  | { type: "APPEND_TIMELINE"; item: SynapseAgentTimelineItem }
  | { type: "CLEAR_TIMELINE" }
  | { type: "SET_PENDING_PERMISSIONS"; permissions: SynapseAgentPendingPermission[] }
  | { type: "SET_STATUS"; status: SynapseAgentStatus | null }
  | { type: "SET_PROVIDERS"; providers: SynapseAgentProviderState | null }
  | { type: "SET_COMMANDS"; commands: SynapseAgentPublishedCommand[] }
  | { type: "SET_FOLLOW_FEISHU"; follow: boolean }
  | { type: "SET_UNREAD"; unread: Record<string, number> }
  | { type: "SELECT_SESSION"; projectId: string | undefined; conversationId: string | undefined; sessionKey: string }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_SENDING"; conversationId: string; sending: boolean }
  | { type: "SET_ERROR"; error: string | null }

export const initialChatState: ChatState = {
  sessions: [],
  archivedSessions: [],
  timeline: [],
  pendingPermissions: [],
  status: null,
  providers: null,
  commands: [],
  followFeishu: false,
  unreadByConversationId: {},
  selectedProjectId: undefined,
  selectedConversationId: undefined,
  selectedSessionKey: "",
  loading: false,
  sendingConversationIds: new Set(),
  error: null,
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_SESSIONS":
      return { ...state, sessions: action.sessions }
    case "SET_ARCHIVED_SESSIONS":
      return { ...state, archivedSessions: action.sessions }
    case "SET_TIMELINE":
      return { ...state, timeline: action.timeline }
    case "APPEND_TIMELINE":
      return { ...state, timeline: [...state.timeline, action.item] }
    case "CLEAR_TIMELINE":
      return { ...state, timeline: [] }
    case "SET_PENDING_PERMISSIONS":
      return { ...state, pendingPermissions: action.permissions }
    case "SET_STATUS":
      return { ...state, status: action.status }
    case "SET_PROVIDERS":
      return { ...state, providers: action.providers }
    case "SET_COMMANDS":
      return { ...state, commands: action.commands }
    case "SET_FOLLOW_FEISHU":
      return { ...state, followFeishu: action.follow }
    case "SET_UNREAD":
      return { ...state, unreadByConversationId: action.unread }
    case "SELECT_SESSION":
      return { ...state, selectedProjectId: action.projectId, selectedConversationId: action.conversationId, selectedSessionKey: action.sessionKey }
    case "SET_LOADING":
      return { ...state, loading: action.loading }
    case "SET_SENDING": {
      const next = new Set(state.sendingConversationIds)
      action.sending ? next.add(action.conversationId) : next.delete(action.conversationId)
      return { ...state, sendingConversationIds: next }
    }
    case "SET_ERROR":
      return { ...state, error: action.error }
  }
}
```

- [ ] **Step 2: 在 use-agent-chat.ts 中替换 useState 为 useReducer**

```typescript
// In use-agent-chat.ts:
import { chatReducer, initialChatState } from "./use-chat-reducer"

// Replace all 15 useState calls with:
const [state, dispatch] = useReducer(chatReducer, initialChatState)

// Replace all setState calls with dispatch:
// setSessions(data) → dispatch({ type: "SET_SESSIONS", sessions: data })
// setLoading(true) → dispatch({ type: "SET_LOADING", loading: true })
// etc.
```

- [ ] **Step 3: 验证编译通过**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/agent/hooks/use-chat-reducer.ts desktop/src/modules/agent/hooks/use-agent-chat.ts
git commit -m "refactor(agent-chat): replace 15 useState with useReducer"
```

---

### Task 16: 拆分 use-agent-chat.ts — 提取子 hooks

**Files:**
- Create: `desktop/src/modules/agent/hooks/use-chat-connection.ts`
- Create: `desktop/src/modules/agent/hooks/use-chat-events.ts`
- Modify: `desktop/src/modules/agent/hooks/use-agent-chat.ts`

- [ ] **Step 1: 提取 IPC 连接逻辑到 use-chat-connection.ts**

提取 `loadTimeline`, `loadSessionsForProjects`, `refreshPendingPermissions`, `refreshProjectMeta`, `refresh`, `createSession`, `selectSession`, `sendMessage`, `deleteSession`, `renameSession`, `respondPermission`：

```typescript
// desktop/src/modules/agent/hooks/use-chat-connection.ts
import type { ChatState, ChatAction } from "./use-chat-reducer"

export function useChatConnection(
  state: ChatState,
  dispatch: React.Dispatch<ChatAction>,
  projectScope: ProjectScope,
) {
  // All IPC interaction methods
  // Uses dispatch instead of individual setters
  // Returns: { refresh, createSession, selectSession, sendMessage, deleteSession, renameSession, respondPermission }
}
```

- [ ] **Step 2: 提取事件监听到 use-chat-events.ts**

提取 lines 555-672 的 useEffect（real-time event listener）：

```typescript
// desktop/src/modules/agent/hooks/use-chat-events.ts
import type { ChatState, ChatAction } from "./use-chat-reducer"

export function useChatEvents(
  state: ChatState,
  dispatch: React.Dispatch<ChatAction>,
  projectScope: ProjectScope,
) {
  // useEffect for event subscription
  // Handles: timeline updates, session updates, permission events
}
```

- [ ] **Step 3: 瘦身 use-agent-chat.ts 为组合入口**

```typescript
// desktop/src/modules/agent/hooks/use-agent-chat.ts
import { useReducer } from "react"
import { chatReducer, initialChatState } from "./use-chat-reducer"
import { useChatConnection } from "./use-chat-connection"
import { useChatEvents } from "./use-chat-events"

export function useAgentChat(projectScope: ProjectScope, options?: ChatOptions) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState)

  const connection = useChatConnection(state, dispatch, projectScope)
  useChatEvents(state, dispatch, projectScope)

  return {
    ...state,
    ...connection,
    sending: state.sendingConversationIds.has(state.selectedConversationId ?? ""),
  }
}
```

- [ ] **Step 4: 验证编译通过**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/hooks/
git commit -m "refactor(agent-chat): extract connection and event hooks"
```

---

### Task 17: 拆分 content-browser-page.tsx — 提取子组件

**Files:**
- Create: `desktop/src/modules/content/components/content-filter-sidebar.tsx`
- Create: `desktop/src/modules/content/components/content-grid.tsx`
- Create: `desktop/src/modules/content/components/content-bulk-actions.tsx`
- Modify: `desktop/src/modules/content/components/content-browser-page.tsx`

- [ ] **Step 1: 提取侧边栏组件**

从 lines 700-816 提取分类导航侧边栏：

```typescript
// desktop/src/modules/content/components/content-filter-sidebar.tsx
interface ContentFilterSidebarProps {
  categories: Category[]
  activeCategoryId: string | null
  onCategorySelect: (id: string | null) => void
  searchQuery: string
  onSearchChange: (query: string) => void
}

export function ContentFilterSidebar({ categories, activeCategoryId, onCategorySelect, searchQuery, onSearchChange }: ContentFilterSidebarProps) {
  // Category navigation, search, favorites, recently viewed, deleted items
}
```

- [ ] **Step 2: 提取内容网格组件**

从 lines 900-963 提取内容卡片网格：

```typescript
// desktop/src/modules/content/components/content-grid.tsx
interface ContentGridProps {
  items: ContentItem[]
  isDeletedView: boolean
  onItemSelect: (item: ContentItem) => void
  onRestore?: (item: ContentItem) => void
  onPurge?: (item: ContentItem) => void
}

export function ContentGrid({ items, isDeletedView, onItemSelect, onRestore, onPurge }: ContentGridProps) {
  // Renders content cards or deleted content cards
}
```

- [ ] **Step 3: 提取批量操作组件**

从 lines 853-898 和 1015-1087 提取批量操作 UI：

```typescript
// desktop/src/modules/content/components/content-bulk-actions.tsx
interface ContentBulkActionsProps {
  selectedItems: ContentItem[]
  onBatchRestore: () => void
  onBatchPurge: () => void
  batchAction: "restore" | "purge" | null
  busyBatchAction: boolean
}

export function ContentBulkActions({ selectedItems, onBatchRestore, onBatchPurge, batchAction, busyBatchAction }: ContentBulkActionsProps) {
  // Batch action buttons + confirmation dialogs
}
```

- [ ] **Step 4: 瘦身 content-browser-page.tsx**

主页面组件只保留状态管理和布局编排，子组件通过 props 通信。

- [ ] **Step 5: 验证编译通过**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/content/components/
git commit -m "refactor(content-browser): decompose into focused sub-components"
```

---

### Task 18: 验证渲染进程拆分结果

**Files:**
- Verify: all modified renderer files

- [ ] **Step 1: 确认文件行数**

Run:
```bash
wc -l /Users/liyang/Documents/code/github/Synapse/desktop/src/modules/agent/hooks/use-agent-chat.ts
wc -l /Users/liyang/Documents/code/github/Synapse/desktop/src/modules/agent/hooks/use-chat-*.ts
wc -l /Users/liyang/Documents/code/github/Synapse/desktop/src/modules/content/components/content-browser-page.tsx
wc -l /Users/liyang/Documents/code/github/Synapse/desktop/src/modules/content/components/content-filter-sidebar.tsx
wc -l /Users/liyang/Documents/code/github/Synapse/desktop/src/modules/content/components/content-grid.tsx
wc -l /Users/liyang/Documents/code/github/Synapse/desktop/src/modules/content/components/content-bulk-actions.tsx
```
Expected: 每个 < 300 行

- [ ] **Step 2: 完整编译检查**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 启动 dev server 验证运行时**

Run: `cd /Users/liyang/Documents/code/github/Synapse && pnpm dev`
Expected: 应用正常启动，内容浏览和 agent 聊天功能正常

---

## Final Verification

### Task 19: 全局验收

- [ ] **Step 1: 确认无文件超过 300 行**

Run:
```bash
find /Users/liyang/Documents/code/github/Synapse/desktop/electron/database -name "*.ts" -not -path "*node_modules*" -not -path "*__tests__*" | xargs wc -l | sort -rn | head -10
find /Users/liyang/Documents/code/github/Synapse/desktop/electron/services/agent-runtime -name "*.ts" -not -path "*node_modules*" -not -path "*__tests__*" -not -path "*adapters*" | xargs wc -l | sort -rn | head -10
```
Expected: 除 legacy migration 代码外，所有新拆分文件 < 300 行

- [ ] **Step 2: 确认无新增 any**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && grep -rn ": any" electron/database/ electron/services/agent-runtime/ src/modules/agent/hooks/ src/modules/content/components/ --include="*.ts" --include="*.tsx" | grep -v node_modules | wc -l`

对比重构前后数量，确认未增加。

- [ ] **Step 3: 确认共享 schema 消除重复**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && grep -rn "projectRequestSchema = z.object" electron/modules/ --include="*.ts"`
Expected: 0 结果（所有模块改为 import）

- [ ] **Step 4: 确认 use-agent-chat 无 useState**

Run: `grep -c "useState" /Users/liyang/Documents/code/github/Synapse/desktop/src/modules/agent/hooks/use-agent-chat.ts`
Expected: 0
