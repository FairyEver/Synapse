# Data Store Table Notes Design

## Context

The Data Store module already persists table metadata in `_meta_tables.description`. `createTable` accepts an optional table description, `listTables()` returns it as `DataStoreTableInfo.description`, and `describeTable()` returns it as `DataStoreTableSchema.description`.

The current renderer does not use that metadata in the table sidebar. `DataStoreSidebar` shows only the raw table name and filters only by table name. The table schema dialog lets users edit column descriptions but does not expose table description editing.

## Goal

Make table descriptions useful in the database management UI:

- The left sidebar keeps the raw table name as the primary label.
- A non-empty table description is shown below the table name in smaller muted text.
- Sidebar search matches both table name and table description.
- The table schema dialog lets users edit the selected table description.
- Saving a table description updates the sidebar immediately after refresh.

## Non-Goals

- Do not rename tables or change how table names are validated.
- Do not make descriptions the primary display label.
- Do not add custom colors, new visual themes, nested cards, or decorative styling.
- Do not expose raw SQL editing for this workflow.
- Do not change CLI, MCP, or HTTP API behavior.

## UX Design

### Sidebar Table Rows

Use the approved compact two-line row:

- First line: raw table name, truncated when needed. Keep it visually primary and suitable for English identifiers.
- Second line: table description, shown only when `description.trim()` is non-empty. Use smaller muted text and truncate to one line.
- Right side: keep the existing row count placement.
- Empty description: render no secondary line. Do not show placeholder copy such as "暂无备注".

The row should remain compact enough for scanning many tables. Extend `ModuleSidebarItem` with an optional `description` prop and keep existing one-line callers unchanged.

### Sidebar Search

Change the search placeholder to `搜索数据表或备注`.

Filtering logic:

- Normalize the query with `trim().toLowerCase()`.
- Match `table.name.toLowerCase()`.
- Match `table.description.toLowerCase()` when description is non-empty.
- Preserve current empty-query behavior: show all tables.

### Table Schema Dialog

Add a table description editor near the top of `TableSchemaSheet`, before the columns table:

- Label: `表备注`
- Input value: `schema.description`
- Save on blur or Enter.
- Escape cancels the local edit.
- Trim before saving.
- Empty string is allowed and clears the description.

Avoid explanatory helper text unless validation or failure requires it.

## Architecture

### Renderer

`DataStoreModule` remains the state owner for table list, selected table, query data, and schema data.

Add a handler:

```ts
async function handleUpdateTableDescription(description: string): Promise<void>
```

Behavior:

- Return early when there is no selected table.
- Call the new hook wrapper `updateTableDescription(selectedTable, description)`.
- Refresh schema so the dialog reflects the persisted value.
- Refresh tables so the sidebar display and search source are current.
- Use existing notification/logger patterns for failures.

`TableSchemaSheet` receives:

```ts
onUpdateTableDescription: (description: string) => Promise<void> | void
```

The sheet owns only transient edit state for the description field.

`DataStoreSidebar` receives the existing `DataStoreTableInfo[]` and renders `description` from each item. It keeps filtering local to the sidebar because it already owns the search query.

### Bridge and Main Process

Add a structured operation named `updateTableDescription` through the same layers as existing table metadata operations:

- renderer hook wrapper in `desktop/src/modules/data-store/hooks/use-data-store.ts`
- bridge type in `desktop/src/types/bridge.ts`
- preload mapping in `desktop/electron/preload.ts`
- channel in `desktop/electron/data-store/channels.ts`
- IPC handler in `desktop/electron/data-store/ipc-handlers.ts`
- service method in `desktop/electron/data-store/service.ts`

The service method updates `_meta_tables.description` and `_meta_tables.updated_at` for an existing table. It should validate the table name using the existing table existence path and accept any string description after renderer trimming.

## Data Flow

1. User opens Data Store module.
2. `useDataStoreTables()` loads `DataStoreTableInfo[]`, including `description`.
3. Sidebar renders table name and optional description.
4. User searches; sidebar filters against name and description.
5. User opens the schema dialog.
6. User edits `表备注` and commits.
7. Renderer calls `updateTableDescription`.
8. Main process updates `_meta_tables`.
9. Renderer refreshes schema and table list.
10. Sidebar displays the updated description and search can match it.

## Error Handling

- If loading tables fails, keep existing fallback behavior.
- If description update fails, log through the existing renderer logger and show a concise error notification.
- Do not silently swallow save failures in the schema dialog.
- Preserve the current dialog state after a failed save so the user can retry or cancel.

## Testing

Add focused coverage:

- Data store service test: updating a table description changes `describeTable()` and `listTables()` output.
- Renderer/sidebar test: table descriptions render below names and search matches descriptions.
- Hook/bridge type changes should be covered by TypeScript.

Verification commands:

- `pnpm desktop:typecheck`
- Related renderer or data-store tests if the repository already has a local pattern for the touched files.

## Implementation Notes

- Use existing shadcn/Radix primitives and Tailwind token classes only.
- Do not use inline styles, hard-coded colors, gradients, or new CSS modules.
- Keep copy short: labels and error text only.
- Keep changes scoped to Data Store module and the necessary bridge/service contracts.
