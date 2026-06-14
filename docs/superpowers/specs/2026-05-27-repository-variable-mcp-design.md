# Repository And Variable MCP Design

## Summary

Add two API + MCP capability domains:

- `repository`: read-only repository discovery.
- `variable`: repository-scoped local variable CRUD.

The goal is to let users ask their own AI agents to inspect configured Synapse repositories and safely manage local variables used by `${{ NAME }}` substitutions. Variables remain repository-scoped local config; this design does not move them into the content Git repository and does not introduce a global variable store.

## Goals

- Expose configured repository discovery through API and MCP.
- Expose local variable list, get, create, update, upsert, and delete through API and MCP.
- Keep API actions and MCP tools fully paired through the shared capability registry.
- Keep variable storage in `SynapseRepositoryConfig.variables`.
- Allow variable tools to accept an optional `repositoryUuid`; omit it to use the current active repository.
- Protect variable values by default: list never returns values, and get only returns a value with `includeValue: true`.
- Add built-in skills for repository discovery and variable management.

## Non-Goals

- No repository create, remove, initialize, sync, maintenance, or Git mutation tools.
- No global variable store.
- No migration of existing variable storage.
- No UI redesign.
- No MCP tool that returns every variable value in bulk.
- No hidden fallback to the first repository when no active repository exists.

## Current Context

Settings > Variables reads and writes `activeRepository.variables`. Content installation also uses the active repository's variables to prefill and optionally save `${{ NAME }}` substitution values.

The existing capability model uses canonical API action ids and maps each action to exactly one MCP tool. HTTP `/api`, HTTP MCP, and stdio MCP all route through the same action router and domain dispatchers. The new repository and variable surfaces must follow that model.

## Capability Domains

### Repository

Domain id:

```text
repository
```

First-version capability:

| API action | MCP tool | Mutates |
| --- | --- | --- |
| `repository.item.list` | `repository_item_list` | no |

The domain is intentionally read-only in this design. Future repository operations require their own design because they can mutate local files, Git state, or Synapse configuration.

### Variable

Domain id:

```text
variable
```

Capabilities:

| API action | MCP tool | Mutates |
| --- | --- | --- |
| `variable.item.list` | `variable_item_list` | no |
| `variable.item.get` | `variable_item_get` | no |
| `variable.item.create` | `variable_item_create` | yes |
| `variable.item.update` | `variable_item_update` | yes |
| `variable.item.upsert` | `variable_item_upsert` | yes |
| `variable.item.delete` | `variable_item_delete` | yes |

`upsert` is a new capability action word. Add it to `CAPABILITY_ACTIONS` so registry parity tests continue to validate action ids and MCP tool names.

## Repository Tool

`repository.item.list` takes no required input.

Response:

```ts
{
  activeRepositoryUuid: string | null
  repositories: Array<{
    uuid: string
    name: string
    localPath: string
    isActive: boolean
  }>
}
```

`localPath` is included so agents can distinguish repositories with similar names. The repository discovery tool must not include variable names or values; use the dedicated variable tools for variable metadata.

## Variable Scope Resolution

Every variable tool accepts:

```ts
{
  repositoryUuid?: string
}
```

Resolution rules:

1. If `repositoryUuid` is provided, use that configured repository.
2. If omitted, use `config.activeRepoUuid`.
3. If the selected repository does not exist, return a clear error.
4. If omitted and there is no active repository, return a clear error.
5. Do not silently choose the first repository.

The built-in variable skill should tell agents to call `repository_item_list` first when the user mentions a repository by name or when the active repository is unclear.

## Variable Model

Stored shape stays unchanged:

```ts
type SynapseVariable = {
  name: string
  value: string
  description?: string
}
```

Validation:

- `name` must match `^[A-Za-z0-9_]+$`.
- Name uniqueness is case-insensitive within one repository.
- Values are strings.
- Empty values are allowed.
- `description` is trimmed; an empty description clears the stored description.

Safe view returned by default:

```ts
{
  name: string
  description?: string
  hasValue: boolean
}
```

Repository-scoped responses should include a minimal repository reference:

```ts
{
  repository: {
    uuid: string
    name: string
    isActive: boolean
  }
}
```

## Variable Tools

### List

Input:

```ts
{
  repositoryUuid?: string
}
```

Response:

```ts
{
  repository: RepositoryRef
  variables: VariableSafeView[]
  total: number
}
```

`variable.item.list` never returns `value` and does not accept an option to include values.

### Get

Input:

```ts
{
  repositoryUuid?: string
  name: string
  includeValue?: boolean
}
```

Response without `includeValue`:

```ts
{
  repository: RepositoryRef
  variable: VariableSafeView
}
```

Response with `includeValue: true`:

```ts
{
  repository: RepositoryRef
  variable: VariableSafeView & { value: string }
}
```

Only this operation can return a variable value.

### Create

Input:

```ts
{
  repositoryUuid?: string
  name: string
  value: string
  description?: string
}
```

Behavior:

- Reject duplicate names case-insensitively.
- Append the new variable to the repository's variable list.
- Do not return the value.

Response:

```ts
{
  repository: RepositoryRef
  variable: VariableSafeView
  created: true
}
```

### Update

Input:

```ts
{
  repositoryUuid?: string
  name: string
  newName?: string
  value?: string
  description?: string
}
```

Behavior:

- `name` identifies the existing variable case-insensitively.
- At least one of `newName`, `value`, or `description` must be provided.
- `newName` must pass the same name validation and must not collide with another variable.
- Omitted fields keep their existing values.
- `description: ""` clears the description.
- Do not return the value.

Response:

```ts
{
  repository: RepositoryRef
  variable: VariableSafeView
  updated: true
}
```

### Upsert

Input:

```ts
{
  repositoryUuid?: string
  name: string
  value?: string
  description?: string
}
```

Behavior:

- If the variable exists, update provided fields.
- If it does not exist, create it.
- Creating through upsert requires `value`; otherwise return a clear error.
- Omitted `description` keeps the old description for existing variables.
- `description: ""` clears the description for existing variables.
- Do not return the value.

Response:

```ts
{
  repository: RepositoryRef
  variable: VariableSafeView
  created: boolean
  updated: boolean
}
```

Exactly one of `created` or `updated` is true.

### Delete

Input:

```ts
{
  repositoryUuid?: string
  name: string
}
```

Behavior:

- Match `name` case-insensitively.
- Reject missing variables with a clear error.
- Remove the variable.
- Return only the deleted safe view.

Response:

```ts
{
  repository: RepositoryRef
  variable: VariableSafeView
  deleted: true
}
```

## Security And Audit

Variables often contain API tokens. Treat explicit value reads and mutations as secret operations.

- `variable.item.list` and `variable.item.get` without `includeValue` do not require secret access because they return metadata only.
- `variable.item.get` with `includeValue: true` checks `PermissionGuard` with `secret.read` and records an audit event.
- `create`, `update`, `upsert`, and `delete` check `PermissionGuard` with `secret.write` and record audit events.
- Audit metadata includes source, action, repository uuid, variable name, and whether a value was requested. It must not include the variable value.
- Logs and renderer-facing errors must not include variable values.
- Mutation responses must not echo values.

The actor for MCP/API-triggered operations should match existing MCP capability practice, for example `{ kind: "user", id: "synapse-mcp", display: "Synapse MCP" }` when dispatched from the MCP setup.

## Service Boundary

Add thin domain dispatchers:

- `repository` dispatcher: reads config and returns repository list.
- `variable` dispatcher: resolves repository, validates input, applies variable changes, and persists through `configStore.update`.

Transport layers must not own business logic:

- HTTP `/api` dispatches `repository.*` and `variable.*` action ids through the action router.
- HTTP MCP maps tool names to action ids and dispatches through the same router.
- stdio MCP calls `/api` with the same action ids.

`createSynapseActionRouter` gains `repositoryDispatch` and `variableDispatch` branches. Unknown actions still fail.

## Renderer Refresh

Variable mutations update persisted app config. To keep the open Settings UI from showing stale variables, the implementation should wake the renderer after mutations.

Use the existing repository event channel rather than adding a new visual surface:

- Extend repository update operation typing with a `variables` operation.
- After a successful variable mutation, emit `repository.updated` with `operation: "variables"` and the affected `repositoryUuid`.
- `AppConfigProvider` should refresh config when it receives that operation.

This event must not trigger Git sync, pending push creation, or repository maintenance.

## Built-In Skills

Add two built-in skill templates.

### Synapse 仓库 MCP

Path:

```text
desktop/resources/templates/skills/synapse-repository-mcp/
```

Files:

- `meta.json`
- `content.md`
- `files/api-reference.md`

Metadata:

```json
{
  "id": "synapse-repository-mcp",
  "name": "synapse-repository-mcp",
  "title": "Synapse 仓库 MCP",
  "description": "Use when listing configured Synapse repositories through MCP tools.",
  "category": "data",
  "icon": "terminal",
  "iconBg": "teal"
}
```

Skill guidance:

- Use only for configured Synapse repository discovery.
- Call `repository_item_list` to find repository uuid, display name, path, and active state.
- Do not claim support for creating, deleting, syncing, initializing, or modifying repositories.
- Use the repository uuid returned by this skill when another Synapse MCP skill needs a repository scope.

### Synapse 变量 MCP

Path:

```text
desktop/resources/templates/skills/synapse-variable-mcp/
```

Files:

- `meta.json`
- `content.md`
- `files/api-reference.md`

Metadata:

```json
{
  "id": "synapse-variable-mcp",
  "name": "synapse-variable-mcp",
  "title": "Synapse 变量 MCP",
  "description": "Use when managing Synapse repository-scoped local variables through MCP tools.",
  "category": "data",
  "icon": "terminal",
  "iconBg": "teal"
}
```

Skill guidance:

- Use only for repository-scoped Synapse local variables.
- If the target repository is unclear, call `repository_item_list` first.
- Omit `repositoryUuid` only when using the current active repository is acceptable.
- Start with `variable_item_list` or `variable_item_get` without `includeValue`.
- Use `includeValue: true` only when the user explicitly needs the stored value.
- Do not repeat token or secret values in the final answer.
- Prefer `variable_item_upsert` when the user wants to set a variable and does not care whether it already exists.
- Call list/get before delete when the repository or variable name is ambiguous.

Each skill's `api-reference.md` should include tool signatures, return shapes, and sensitive value rules.

## Tests

Focused tests:

- Capability registry exposes every `repository` and `variable` action as exactly one MCP tool.
- Action router routes every new action to the correct dispatcher.
- `repository_item_list` returns configured repositories and active state.
- Variable list omits values.
- Variable get omits values by default and includes values only with `includeValue: true`.
- Secret reads call `PermissionGuard` with `secret.read` and audit without values.
- Mutations call `PermissionGuard` with `secret.write` and audit without values.
- Create rejects duplicate names case-insensitively.
- Update supports rename, value change, description clear, and duplicate rename rejection.
- Upsert creates when missing and updates when present.
- Upsert without `value` rejects when creating.
- Delete removes the variable and rejects missing names.
- `processMcpRequest` can list and call representative repository and variable tools.
- Added built-in skill `meta.json` files parse as JSON.

Validation commands should include:

```text
pnpm --filter @synapse/desktop exec vitest run desktop/tests/unit/api-mcp-capability-surface.test.ts
pnpm --filter @synapse/desktop exec vitest run desktop/electron/capabilities/__tests__/repository-dispatcher.test.ts desktop/electron/capabilities/__tests__/variable-dispatcher.test.ts
pnpm --filter @synapse/desktop run typecheck
```

## Documentation

Update the capability naming matrix with the new API actions and MCP tools.

Because the implementation will be user-visible, update `RELEASE_NOTES_PENDING.md` when implementing the feature. The design-only change does not need a release note entry.

## Acceptance Criteria

- `repository_item_list` is available through MCP and `/api`.
- `variable_item_*` tools are available through MCP and `/api`.
- API/MCP parity tests pass.
- Variable values are not exposed by list or mutation responses.
- `includeValue: true` is the only way to read one variable value.
- Variable value reads and mutations are audited without storing values in logs or audit metadata.
- Variable tools operate on the requested repository or the active repository when omitted.
- Renderer config refreshes after successful variable MCP mutations.
- Built-in repository and variable MCP skills install from templates and include API references.
