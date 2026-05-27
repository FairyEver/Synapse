# Repository And Variable MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add API/MCP-equivalent repository discovery and repository-scoped local variable management, with built-in skills that teach agents how to use the new tools safely.

**Architecture:** Add read-only `repository` and mutable `variable` capability domains to the existing shared registry. Both HTTP `/api` and MCP transports route through `createSynapseActionRouter` into thin Electron capability dispatchers. Variable values remain in `SynapseRepositoryConfig.variables`; list and mutation responses never echo values, and explicit value reads require `includeValue: true`.

**Tech Stack:** Electron main process, TypeScript, shared Synapse capability registry, Vitest, EventBus, shadcn/Radix renderer baseline only for existing Settings refresh behavior.

---

## File Structure

- Create `desktop/synapse-capabilities/shared/repository-domain.ts`
  - Owns `REPOSITORY_DOMAIN`, `REPOSITORY_MCP_TOOL_ACTIONS`, and `buildRepositoryTools()`.
- Create `desktop/synapse-capabilities/shared/variable-domain.ts`
  - Owns `VARIABLE_DOMAIN`, `VARIABLE_MCP_TOOL_ACTIONS`, variable tool input schemas, and `buildVariableTools()`.
- Modify `desktop/synapse-capabilities/shared/naming.ts`
  - Add `upsert` to the allowed action vocabulary.
- Modify `desktop/synapse-capabilities/shared/registry.ts`
  - Register repository and variable domains, actions, and MCP tools.
- Modify `desktop/electron/capabilities/action-router.ts`
  - Add `repositoryDispatch` and `variableDispatch` dependencies and routing.
- Create `desktop/electron/capabilities/repository-dispatcher.ts`
  - Reads config and returns configured repository summaries.
- Create `desktop/electron/capabilities/variable-dispatcher.ts`
  - Resolves repository scope, validates variables, audits secret reads/writes, persists config updates, emits repository refresh events.
- Modify `desktop/electron/bootstrap/descriptors.ts`
  - Instantiate the new dispatchers and pass them to the action router.
- Modify `desktop/database/shared/mcp-rpc.ts`
  - Return `repository.*` and `variable.*` dispatcher `data` directly, matching Scheduler/Workflow/Content behavior.
- Modify `desktop/src/types/repository.ts`
  - Add `variables` to `SynapseRepositoryOperationKind`.
- Modify `desktop/src/app-shell/config.tsx`
  - Refresh config when a `repository.updated` event with `operation: "variables"` arrives.
- Modify `desktop/src/app-shell/__tests__/config.test.tsx`
  - Cover config refresh after variable mutation events.
- Create `desktop/electron/capabilities/__tests__/repository-dispatcher.test.ts`
  - Covers repository list behavior.
- Create `desktop/electron/capabilities/__tests__/variable-dispatcher.test.ts`
  - Covers scope resolution, safe reads, explicit value reads, mutations, audit, and event emission.
- Modify `desktop/tests/unit/api-mcp-capability-surface.test.ts`
  - Include new domain dispatchers in router parity tests.
- Modify `desktop/tests/unit/synapse-capabilities.test.ts`
  - Cover new domains and MCP action mappings.
- Modify `desktop/tests/unit/database-mcp-rpc.test.ts`
  - Cover MCP result normalization for repository and variable actions.
- Modify `desktop/electron/services/__tests__/repository-template-service.test.ts`
  - Include new built-in MCP skills in icon consistency expectations.
- Create `desktop/resources/templates/skills/synapse-repository-mcp/`
  - Built-in repository discovery skill.
- Create `desktop/resources/templates/skills/synapse-variable-mcp/`
  - Built-in variable management skill.
- Modify `docs/reference/capability-naming-matrix.md`
  - Add repository and variable action/tool rows.
- Modify `website/developer/capability-naming-matrix.md`
  - Mirror the capability matrix rows for the website.
- Modify `website/reference/synapse-mcp-capabilities.md`
  - Add repository and variable domains to the current domain list and source list.
- Modify `RELEASE_NOTES_PENDING.md`
  - Add a user-facing feature note.

## Task 1: Capability Registry And Router

**Files:**
- Modify: `desktop/synapse-capabilities/shared/naming.ts`
- Create: `desktop/synapse-capabilities/shared/repository-domain.ts`
- Create: `desktop/synapse-capabilities/shared/variable-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/registry.ts`
- Modify: `desktop/electron/capabilities/action-router.ts`
- Modify: `desktop/tests/unit/synapse-capabilities.test.ts`
- Modify: `desktop/tests/unit/api-mcp-capability-surface.test.ts`

- [ ] **Step 1: Write failing capability tests**

Update `desktop/tests/unit/synapse-capabilities.test.ts` imports:

```ts
import {
  REPOSITORY_DOMAIN,
  REPOSITORY_MCP_TOOL_ACTIONS,
  buildRepositoryTools,
} from "../../synapse-capabilities/shared/repository-domain"
import {
  VARIABLE_DOMAIN,
  VARIABLE_MCP_TOOL_ACTIONS,
  buildVariableTools,
} from "../../synapse-capabilities/shared/variable-domain"
```

Add these test blocks after the model price block and before Scheduler:

```ts
describe("Repository capability domain", () => {
  it("registers read-only repository discovery", () => {
    expect(REPOSITORY_DOMAIN.id).toBe("repository")
    expect(REPOSITORY_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "repository.item.list",
    ])
    expect(REPOSITORY_DOMAIN.capabilities.every((capability) => capability.mutates === false)).toBe(true)
  })

  it("maps repository MCP tools to canonical actions", () => {
    expect(REPOSITORY_MCP_TOOL_ACTIONS.repository_item_list).toBe("repository.item.list")
    expect(buildRepositoryTools().map((tool) => tool.name)).toEqual(["repository_item_list"])
  })
})

describe("Variable capability domain", () => {
  it("registers repository-scoped variable CRUD actions", () => {
    expect(VARIABLE_DOMAIN.id).toBe("variable")
    expect(VARIABLE_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "variable.item.list",
      "variable.item.get",
      "variable.item.create",
      "variable.item.update",
      "variable.item.upsert",
      "variable.item.delete",
    ])
  })

  it("maps variable MCP tools to canonical actions", () => {
    expect(VARIABLE_MCP_TOOL_ACTIONS.variable_item_list).toBe("variable.item.list")
    expect(VARIABLE_MCP_TOOL_ACTIONS.variable_item_get).toBe("variable.item.get")
    expect(VARIABLE_MCP_TOOL_ACTIONS.variable_item_upsert).toBe("variable.item.upsert")
    expect(buildVariableTools().map((tool) => tool.name)).toEqual([
      "variable_item_list",
      "variable_item_get",
      "variable_item_create",
      "variable_item_update",
      "variable_item_upsert",
      "variable_item_delete",
    ])
  })

  it("keeps variable list from exposing a value field", () => {
    const listTool = buildVariableTools().find((tool) => tool.name === "variable_item_list")
    expect(listTool?.inputSchema.properties).not.toHaveProperty("includeValue")
    expect(listTool?.inputSchema.properties).not.toHaveProperty("value")
  })
})
```

Extend the existing "combines model price tools with all MCP tools" test or add this assertion in a new test:

```ts
it("combines Repository and Variable tools with all MCP tools", () => {
  const toolNames = buildAllMcpTools().map((tool) => tool.name)
  expect(toolNames).toContain("repository_item_list")
  expect(toolNames).toContain("variable_item_list")
  expect(toolNames).toContain("variable_item_upsert")
  expect(MCP_TOOL_ACTIONS.repository_item_list).toBe("repository.item.list")
  expect(MCP_TOOL_ACTIONS.variable_item_delete).toBe("variable.item.delete")
  expect(getActionDomainId("repository.item.list")).toBe("repository")
  expect(getActionDomainId("variable.item.upsert")).toBe("variable")
})
```

Update `desktop/tests/unit/api-mcp-capability-surface.test.ts` dispatcher setup:

```ts
const dispatchers = {
  content: vi.fn(async () => ({ ok: true as const })),
  database: vi.fn(async () => ({ ok: true as const })),
  model_price: vi.fn(async () => ({ ok: true as const })),
  repository: vi.fn(async () => ({ ok: true as const })),
  scheduler: vi.fn(async () => ({ ok: true as const })),
  variable: vi.fn(async () => ({ ok: true as const })),
  workflow: vi.fn(async () => ({ ok: true as const })),
}
const router = createSynapseActionRouter({
  contentDispatch: dispatchers.content,
  databaseDispatch: dispatchers.database,
  modelPriceDispatch: dispatchers.model_price,
  repositoryDispatch: dispatchers.repository,
  schedulerDispatch: dispatchers.scheduler,
  variableDispatch: dispatchers.variable,
  workflowDispatch: dispatchers.workflow,
})
```

- [ ] **Step 2: Run capability tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts tests/unit/api-mcp-capability-surface.test.ts
```

Expected: FAIL with missing `repository-domain`, missing `variable-domain`, invalid `upsert` capability id, or missing action router deps.

- [ ] **Step 3: Add `upsert` to capability naming**

Modify `desktop/synapse-capabilities/shared/naming.ts`:

```ts
const CAPABILITY_ACTIONS = [
  "list",
  "get",
  "create",
  "update",
  "upsert",
  "delete",
  "count",
  "rename",
  "describe",
  "inspect",
  "enable",
  "disable",
  "read",
  "execute",
  "reorder",
  "move",
] as const
```

- [ ] **Step 4: Create repository domain**

Create `desktop/synapse-capabilities/shared/repository-domain.ts`:

```ts
import type { CapabilityId } from "./naming"
import { capabilityIdToMcpTool } from "./naming"
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"

const repositoryCapabilities: readonly CapabilityDefinition[] = [
  {
    id: "repository.item.list" as CapabilityId,
    title: "List repositories",
    description: "List configured Synapse repositories and identify the active repository.",
    mutates: false,
  },
]

export const REPOSITORY_DOMAIN: CapabilityDomainDefinition = {
  id: "repository",
  capabilities: repositoryCapabilities,
}

export const REPOSITORY_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(
  repositoryCapabilities.map((capability) => [capabilityIdToMcpTool(capability.id), capability.id]),
)

export function buildRepositoryTools(): McpToolDefinition[] {
  return [
    {
      name: "repository_item_list",
      description: "List configured Synapse repositories. Returns uuid, name, local path, active state, and local variable count. This tool is read-only.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ]
}
```

- [ ] **Step 5: Create variable domain**

Create `desktop/synapse-capabilities/shared/variable-domain.ts`:

```ts
import type { CapabilityId } from "./naming"
import { capabilityIdToMcpTool } from "./naming"
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"

const variableCapabilities: readonly CapabilityDefinition[] = [
  { id: "variable.item.list" as CapabilityId, title: "List variables", description: "List local variables for one repository without values.", mutates: false },
  { id: "variable.item.get" as CapabilityId, title: "Get variable", description: "Get one local variable, optionally including its value.", mutates: false },
  { id: "variable.item.create" as CapabilityId, title: "Create variable", description: "Create one local variable in one repository.", mutates: true },
  { id: "variable.item.update" as CapabilityId, title: "Update variable", description: "Update or rename one existing local variable.", mutates: true },
  { id: "variable.item.upsert" as CapabilityId, title: "Upsert variable", description: "Create or update one local variable.", mutates: true },
  { id: "variable.item.delete" as CapabilityId, title: "Delete variable", description: "Delete one local variable from one repository.", mutates: true },
]

export const VARIABLE_DOMAIN: CapabilityDomainDefinition = {
  id: "variable",
  capabilities: variableCapabilities,
}

export const VARIABLE_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(
  variableCapabilities.map((capability) => [capabilityIdToMcpTool(capability.id), capability.id]),
)

const repositoryUuidProperty = {
  type: "string",
  description: "Optional repository uuid. Omit to use the current active repository.",
}

const nameProperty = {
  type: "string",
  description: "Variable name. Must contain only letters, digits, and underscores.",
}

const descriptionProperty = {
  type: "string",
  description: "Optional description. Pass an empty string to clear an existing description.",
}

const valueProperty = {
  type: "string",
  description: "Variable value. Values are treated as sensitive and are never returned by mutation tools.",
}

export function buildVariableTools(): McpToolDefinition[] {
  return [
    {
      name: "variable_item_list",
      description: "List repository-scoped Synapse local variables without returning values.",
      inputSchema: {
        type: "object",
        properties: {
          repositoryUuid: repositoryUuidProperty,
        },
      },
    },
    {
      name: "variable_item_get",
      description: "Get one repository-scoped local variable. The value is returned only when includeValue is true.",
      inputSchema: {
        type: "object",
        properties: {
          repositoryUuid: repositoryUuidProperty,
          name: nameProperty,
          includeValue: {
            type: "boolean",
            description: "When true, return the variable value. Use only when the user explicitly needs the stored value.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "variable_item_create",
      description: "Create one local variable. Fails if a case-insensitive name match already exists.",
      inputSchema: {
        type: "object",
        properties: {
          repositoryUuid: repositoryUuidProperty,
          name: nameProperty,
          value: valueProperty,
          description: descriptionProperty,
        },
        required: ["name", "value"],
      },
    },
    {
      name: "variable_item_update",
      description: "Update an existing local variable. Omitted fields keep their current values.",
      inputSchema: {
        type: "object",
        properties: {
          repositoryUuid: repositoryUuidProperty,
          name: nameProperty,
          newName: {
            type: "string",
            description: "Optional replacement name. Must not collide with another variable in the same repository.",
          },
          value: valueProperty,
          description: descriptionProperty,
        },
        required: ["name"],
      },
    },
    {
      name: "variable_item_upsert",
      description: "Create or update one local variable. Creating requires value; updating changes only provided fields.",
      inputSchema: {
        type: "object",
        properties: {
          repositoryUuid: repositoryUuidProperty,
          name: nameProperty,
          value: valueProperty,
          description: descriptionProperty,
        },
        required: ["name"],
      },
    },
    {
      name: "variable_item_delete",
      description: "Delete one local variable by name.",
      inputSchema: {
        type: "object",
        properties: {
          repositoryUuid: repositoryUuidProperty,
          name: nameProperty,
        },
        required: ["name"],
      },
    },
  ]
}
```

- [ ] **Step 6: Register domains and route actions**

Modify `desktop/synapse-capabilities/shared/registry.ts` imports:

```ts
import {
  REPOSITORY_DOMAIN,
  REPOSITORY_MCP_TOOL_ACTIONS,
  buildRepositoryTools,
} from "./repository-domain"
import {
  VARIABLE_DOMAIN,
  VARIABLE_MCP_TOOL_ACTIONS,
  buildVariableTools,
} from "./variable-domain"
```

Update exports:

```ts
export const CAPABILITY_DOMAINS: readonly CapabilityDomainDefinition[] = [
  DATABASE_DOMAIN,
  MODEL_PRICE_DOMAIN,
  REPOSITORY_DOMAIN,
  VARIABLE_DOMAIN,
  SCHEDULER_DOMAIN,
  WORKFLOW_DOMAIN,
  CONTENT_DOMAIN,
]

export const MCP_TOOL_ACTIONS: Record<string, string> = {
  ...buildDatabaseMcpToolActions(),
  ...MODEL_PRICE_MCP_TOOL_ACTIONS,
  ...REPOSITORY_MCP_TOOL_ACTIONS,
  ...VARIABLE_MCP_TOOL_ACTIONS,
  ...SCHEDULER_MCP_TOOL_ACTIONS,
  ...WORKFLOW_MCP_TOOL_ACTIONS,
  ...CONTENT_MCP_TOOL_ACTIONS,
}

export function buildAllMcpTools(): McpToolDefinition[] {
  return [
    ...buildDatabaseTools(),
    ...buildModelPriceTools(),
    ...buildRepositoryTools(),
    ...buildVariableTools(),
    ...buildSchedulerTools(),
    ...buildWorkflowTools(),
    ...buildContentTools(),
  ]
}
```

Modify `desktop/electron/capabilities/action-router.ts`:

```ts
export type SynapseActionRouterDeps = {
  readonly contentDispatch: DomainDispatch
  readonly databaseDispatch: DomainDispatch
  readonly modelPriceDispatch: DomainDispatch
  readonly repositoryDispatch: DomainDispatch
  readonly schedulerDispatch: DomainDispatch
  readonly variableDispatch: DomainDispatch
  readonly workflowDispatch: DomainDispatch
}
```

Add branches:

```ts
if (domainId === "repository") return deps.repositoryDispatch(action, params, context)
if (domainId === "variable") return deps.variableDispatch(action, params, context)
```

- [ ] **Step 7: Run capability tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts tests/unit/api-mcp-capability-surface.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit capability registry work**

```bash
git add desktop/synapse-capabilities/shared/naming.ts desktop/synapse-capabilities/shared/repository-domain.ts desktop/synapse-capabilities/shared/variable-domain.ts desktop/synapse-capabilities/shared/registry.ts desktop/electron/capabilities/action-router.ts desktop/tests/unit/synapse-capabilities.test.ts desktop/tests/unit/api-mcp-capability-surface.test.ts
git commit -m "feat: register repository and variable capabilities"
```

## Task 2: Repository Dispatcher

**Files:**
- Create: `desktop/electron/capabilities/repository-dispatcher.ts`
- Create: `desktop/electron/capabilities/__tests__/repository-dispatcher.test.ts`

- [ ] **Step 1: Write failing repository dispatcher tests**

Create `desktop/electron/capabilities/__tests__/repository-dispatcher.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createDefaultConfig } from "../../../src/lib/config"
import type { SynapseConfig } from "../../../src/types/config"
import { createRepositoryCapabilityDispatcher } from "../repository-dispatcher"

function configFixture(patch: Partial<SynapseConfig> = {}): SynapseConfig {
  return {
    ...createDefaultConfig(),
    ...patch,
  }
}

describe("repository capability dispatcher", () => {
  it("lists configured repositories and marks the active repository", async () => {
    const dispatcher = createRepositoryCapabilityDispatcher({
      loadConfig: async () => configFixture({
        activeRepoUuid: "repo-2",
        repositories: [
          {
            uuid: "repo-1",
            name: "One",
            localPath: "/repo/one",
            contentDirs: {},
            variables: [{ name: "TOKEN", value: "secret" }],
          },
          {
            uuid: "repo-2",
            name: "Two",
            localPath: "/repo/two",
            contentDirs: {},
          },
        ],
      }),
    })

    await expect(dispatcher.dispatch("repository.item.list", {}, { source: "api" }))
      .resolves.toEqual({
        ok: true,
        data: {
          activeRepositoryUuid: "repo-2",
          repositories: [
            {
              uuid: "repo-1",
              name: "One",
              localPath: "/repo/one",
              isActive: false,
              variableCount: 1,
            },
            {
              uuid: "repo-2",
              name: "Two",
              localPath: "/repo/two",
              isActive: true,
              variableCount: 0,
            },
          ],
        },
        total: 2,
      })
  })

  it("rejects unknown repository actions", async () => {
    const dispatcher = createRepositoryCapabilityDispatcher({
      loadConfig: async () => configFixture(),
    })

    await expect(dispatcher.dispatch("repository.item.delete", {}, { source: "api" }))
      .rejects.toThrow("Unknown repository action")
  })
})
```

- [ ] **Step 2: Run repository dispatcher tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/repository-dispatcher.test.ts
```

Expected: FAIL because `repository-dispatcher.ts` does not exist.

- [ ] **Step 3: Implement repository dispatcher**

Create `desktop/electron/capabilities/repository-dispatcher.ts`:

```ts
import type { SynapseConfig, SynapseRepositoryConfig } from "../../src/types/config"
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"

type RepositoryCapabilityDispatcherDeps = {
  readonly loadConfig: () => Promise<SynapseConfig>
}

type RepositorySummary = {
  readonly uuid: string
  readonly name: string
  readonly localPath: string
  readonly isActive: boolean
  readonly variableCount: number
}

export function createRepositoryCapabilityDispatcher(deps: RepositoryCapabilityDispatcherDeps) {
  return {
    async dispatch(action: string, _params: Record<string, unknown>, _context: DispatchContext): Promise<DispatchResult> {
      switch (action) {
        case "repository.item.list": {
          const config = await deps.loadConfig()
          const repositories = config.repositories.map((repository) =>
            toRepositorySummary(repository, config.activeRepoUuid),
          )
          return {
            ok: true,
            data: {
              activeRepositoryUuid: config.activeRepoUuid,
              repositories,
            },
            total: repositories.length,
          }
        }
        default:
          throw new Error(`Unknown repository action: ${action}`)
      }
    },
  }
}

function toRepositorySummary(
  repository: SynapseRepositoryConfig,
  activeRepositoryUuid: string | null,
): RepositorySummary {
  return {
    uuid: repository.uuid,
    name: repository.name,
    localPath: repository.localPath,
    isActive: repository.uuid === activeRepositoryUuid,
    variableCount: repository.variables?.length ?? 0,
  }
}
```

- [ ] **Step 4: Run repository dispatcher tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/repository-dispatcher.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit repository dispatcher**

```bash
git add desktop/electron/capabilities/repository-dispatcher.ts desktop/electron/capabilities/__tests__/repository-dispatcher.test.ts
git commit -m "feat: add repository capability dispatcher"
```

## Task 3: Variable Dispatcher

**Files:**
- Create: `desktop/electron/capabilities/variable-dispatcher.ts`
- Create: `desktop/electron/capabilities/__tests__/variable-dispatcher.test.ts`

- [ ] **Step 1: Write failing variable dispatcher tests**

Create `desktop/electron/capabilities/__tests__/variable-dispatcher.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createDefaultConfig } from "../../../src/lib/config"
import type { SynapseConfig, SynapseConfigPatch } from "../../../src/types/config"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { createVariableCapabilityDispatcher } from "../variable-dispatcher"

function configFixture(patch: Partial<SynapseConfig> = {}): SynapseConfig {
  return {
    ...createDefaultConfig(),
    ...patch,
  }
}

function createHarness(config: SynapseConfig) {
  let current = structuredClone(config)
  const auditEvents: Parameters<AuditSink["record"]>[0][] = []
  const emitted: unknown[] = []
  const permissionGuard: PermissionGuard = {
    registerPolicy: vi.fn(),
    check: vi.fn(async () => ({ allowed: true })),
  }
  const auditSink: AuditSink = {
    record: (event) => { auditEvents.push(event) },
    list: () => [],
    clearForTests: () => undefined,
  }
  const updateConfig = vi.fn(async (patch: SynapseConfigPatch) => {
    current = {
      ...current,
      ...patch,
      repositories: patch.repositories ?? current.repositories,
      global: { ...current.global, ...patch.global },
      agent: { ...current.agent, ...patch.agent },
    }
    return structuredClone(current)
  })
  const dispatcher = createVariableCapabilityDispatcher({
    loadConfig: async () => structuredClone(current),
    updateConfig,
    permissionGuard,
    auditSink,
    eventBus: {
      emit: (event: unknown) => { emitted.push(event) },
    },
    actor: { kind: "user", id: "synapse-mcp", display: "Synapse MCP" },
  })
  return { auditEvents, dispatcher, emitted, permissionGuard, updateConfig, getConfig: () => current }
}

const baseConfig = configFixture({
  activeRepoUuid: "repo-1",
  repositories: [
    {
      uuid: "repo-1",
      name: "Main",
      localPath: "/repo/main",
      contentDirs: {},
      variables: [
        { name: "TOKEN", value: "secret", description: "api token" },
        { name: "EMPTY", value: "" },
      ],
    },
    {
      uuid: "repo-2",
      name: "Other",
      localPath: "/repo/other",
      contentDirs: {},
      variables: [{ name: "OTHER", value: "other-secret" }],
    },
  ],
})

describe("variable capability dispatcher", () => {
  it("lists variables in the active repository without values", async () => {
    const { dispatcher } = createHarness(baseConfig)

    await expect(dispatcher.dispatch("variable.item.list", {}, { source: "api" }))
      .resolves.toEqual({
        ok: true,
        data: {
          repository: { uuid: "repo-1", name: "Main", isActive: true },
          variables: [
            { name: "TOKEN", description: "api token", hasValue: true },
            { name: "EMPTY", hasValue: false },
          ],
          total: 2,
        },
        total: 2,
      })
  })

  it("uses repositoryUuid when provided", async () => {
    const { dispatcher } = createHarness(baseConfig)
    const result = await dispatcher.dispatch("variable.item.list", { repositoryUuid: "repo-2" }, { source: "api" })

    expect(result).toMatchObject({
      data: {
        repository: { uuid: "repo-2", name: "Other", isActive: false },
        variables: [{ name: "OTHER", hasValue: true }],
      },
    })
  })

  it("gets one variable without value by default", async () => {
    const { dispatcher, permissionGuard } = createHarness(baseConfig)

    await expect(dispatcher.dispatch("variable.item.get", { name: "token" }, { source: "api" }))
      .resolves.toMatchObject({
        data: {
          variable: { name: "TOKEN", description: "api token", hasValue: true },
        },
      })
    expect(permissionGuard.check).not.toHaveBeenCalled()
  })

  it("requires secret.read and audits when includeValue is true", async () => {
    const { auditEvents, dispatcher, permissionGuard } = createHarness(baseConfig)

    await expect(dispatcher.dispatch("variable.item.get", { name: "TOKEN", includeValue: true }, { source: "mcp-http" }))
      .resolves.toMatchObject({
        data: {
          variable: { name: "TOKEN", value: "secret", hasValue: true },
        },
      })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "secret.read",
      actor: { kind: "user", id: "synapse-mcp", display: "Synapse MCP" },
      resource: "variable:repo-1:TOKEN",
      context: {
        source: "mcp-http",
        variableAction: "variable.item.get",
        repositoryUuid: "repo-1",
        variableName: "TOKEN",
        includeValue: true,
      },
    })
    expect(JSON.stringify(auditEvents)).not.toContain("secret")
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "secret.read",
      outcome: "allowed",
      resource: "variable:repo-1:TOKEN",
    }))
  })

  it("creates updates upserts and deletes variables without echoing values", async () => {
    const { auditEvents, dispatcher, emitted, getConfig, permissionGuard, updateConfig } = createHarness(baseConfig)

    await expect(dispatcher.dispatch("variable.item.create", {
      name: "BARK_ID",
      value: "new-secret",
      description: "phone push",
    }, { source: "mcp-http" })).resolves.toMatchObject({
      data: {
        variable: { name: "BARK_ID", description: "phone push", hasValue: true },
        created: true,
      },
    })

    await expect(dispatcher.dispatch("variable.item.update", {
      name: "BARK_ID",
      newName: "BARK_TOKEN",
      value: "changed-secret",
      description: "",
    }, { source: "mcp-http" })).resolves.toMatchObject({
      data: {
        variable: { name: "BARK_TOKEN", hasValue: true },
        updated: true,
      },
    })

    await expect(dispatcher.dispatch("variable.item.upsert", {
      name: "BARK_TOKEN",
      description: "renamed token",
    }, { source: "mcp-http" })).resolves.toMatchObject({
      data: {
        variable: { name: "BARK_TOKEN", description: "renamed token", hasValue: true },
        created: false,
        updated: true,
      },
    })

    await expect(dispatcher.dispatch("variable.item.delete", { name: "BARK_TOKEN" }, { source: "mcp-http" }))
      .resolves.toMatchObject({
        data: {
          variable: { name: "BARK_TOKEN", description: "renamed token", hasValue: true },
          deleted: true,
        },
      })

    expect(getConfig().repositories[0]?.variables?.map((variable) => variable.name)).toEqual(["TOKEN", "EMPTY"])
    expect(updateConfig).toHaveBeenCalled()
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({ action: "secret.write" }))
    expect(JSON.stringify(auditEvents)).not.toContain("new-secret")
    expect(JSON.stringify(auditEvents)).not.toContain("changed-secret")
    expect(emitted).toContainEqual(expect.objectContaining({
      domain: "repository",
      type: "repository.updated",
      payload: expect.objectContaining({
        repositoryUuid: "repo-1",
        operation: "variables",
      }),
    }))
  })

  it("rejects invalid scopes names duplicates and missing creation values", async () => {
    const { dispatcher } = createHarness(configFixture({
      activeRepoUuid: null,
      repositories: baseConfig.repositories,
    }))

    await expect(dispatcher.dispatch("variable.item.list", {}, { source: "api" }))
      .rejects.toThrow("No active repository")
    await expect(dispatcher.dispatch("variable.item.list", { repositoryUuid: "missing" }, { source: "api" }))
      .rejects.toThrow("Repository not found")
    await expect(dispatcher.dispatch("variable.item.create", { repositoryUuid: "repo-1", name: "bad-name", value: "x" }, { source: "api" }))
      .rejects.toThrow("Variable name")
    await expect(dispatcher.dispatch("variable.item.create", { repositoryUuid: "repo-1", name: "token", value: "x" }, { source: "api" }))
      .rejects.toThrow("already exists")
    await expect(dispatcher.dispatch("variable.item.upsert", { repositoryUuid: "repo-1", name: "NEW_ONE" }, { source: "api" }))
      .rejects.toThrow("requires 'value'")
    await expect(dispatcher.dispatch("variable.item.update", { repositoryUuid: "repo-1", name: "missing", value: "x" }, { source: "api" }))
      .rejects.toThrow("Variable not found")
    await expect(dispatcher.dispatch("variable.item.delete", { repositoryUuid: "repo-1", name: "missing" }, { source: "api" }))
      .rejects.toThrow("Variable not found")
  })

  it("blocks secret operations when permission is denied", async () => {
    const { dispatcher, permissionGuard } = createHarness(baseConfig)
    vi.mocked(permissionGuard.check).mockResolvedValueOnce({ allowed: false, reason: "denied by test", policyId: "test" })

    await expect(dispatcher.dispatch("variable.item.get", { name: "TOKEN", includeValue: true }, { source: "mcp-http" }))
      .rejects.toThrow("denied by test")
  })
})
```

- [ ] **Step 2: Run variable dispatcher tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/variable-dispatcher.test.ts
```

Expected: FAIL because `variable-dispatcher.ts` does not exist.

- [ ] **Step 3: Implement variable dispatcher public types and dispatch switch**

Create `desktop/electron/capabilities/variable-dispatcher.ts` with these imports and top-level types:

```ts
import type { EventBus } from "../runtime/event-bus"
import type { ActorIdentity, AuditSink, PermissionGuard, PermissionAction } from "../runtime/security"
import type { SynapseConfig, SynapseConfigPatch, SynapseRepositoryConfig, SynapseVariable } from "../../src/types/config"
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"

type VariableCapabilityDispatcherDeps = {
  readonly loadConfig: () => Promise<SynapseConfig>
  readonly updateConfig: (patch: SynapseConfigPatch) => Promise<SynapseConfig>
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly eventBus?: Pick<EventBus, "emit">
  readonly actor?: ActorIdentity
}

type RepositoryRef = {
  readonly uuid: string
  readonly name: string
  readonly isActive: boolean
}

type VariableSafeView = {
  readonly name: string
  readonly description?: string
  readonly hasValue: boolean
}

type ResolvedRepository = {
  readonly config: SynapseConfig
  readonly repository: SynapseRepositoryConfig
}

const VARIABLE_NAME_REGEX = /^[A-Za-z0-9_]+$/
const DEFAULT_ACTOR: ActorIdentity = { kind: "user", id: "synapse-mcp", display: "Synapse MCP" }
```

Add the dispatcher:

```ts
export function createVariableCapabilityDispatcher(deps: VariableCapabilityDispatcherDeps) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      switch (action) {
        case "variable.item.list":
          return listVariables(deps, params)
        case "variable.item.get":
          return getVariable(deps, action, params, context)
        case "variable.item.create":
          return createVariable(deps, action, params, context)
        case "variable.item.update":
          return updateVariable(deps, action, params, context)
        case "variable.item.upsert":
          return upsertVariable(deps, action, params, context)
        case "variable.item.delete":
          return deleteVariable(deps, action, params, context)
        default:
          throw new Error(`Unknown variable action: ${action}`)
      }
    },
  }
}
```

- [ ] **Step 4: Implement validation and read helpers**

Add helper functions:

```ts
async function resolveRepository(deps: VariableCapabilityDispatcherDeps, params: Record<string, unknown>): Promise<ResolvedRepository> {
  const config = await deps.loadConfig()
  const repositoryUuid = optionalString(params.repositoryUuid) ?? config.activeRepoUuid
  if (!repositoryUuid) throw new Error("No active repository. Pass repositoryUuid explicitly.")
  const repository = config.repositories.find((item) => item.uuid === repositoryUuid)
  if (!repository) throw new Error(`Repository not found: ${repositoryUuid}`)
  return { config, repository }
}

function requireVariableName(params: Record<string, unknown>, key: string): string {
  const value = optionalString(params[key])
  if (!value) throw new Error(`Missing or invalid '${key}': expected non-empty string`)
  if (!VARIABLE_NAME_REGEX.test(value)) {
    throw new Error("Variable name must contain only letters, digits, and underscores.")
  }
  return value
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== "string") throw new Error(`Missing or invalid '${key}': expected string`)
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalDescription(params: Record<string, unknown>): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(params, "description")) return undefined
  const value = params.description
  if (typeof value !== "string") throw new Error("Invalid 'description': expected string")
  return value.trim()
}

function findVariableIndex(variables: readonly SynapseVariable[], name: string): number {
  const normalized = name.toLowerCase()
  return variables.findIndex((variable) => variable.name.toLowerCase() === normalized)
}

function requireExistingVariable(variables: readonly SynapseVariable[], name: string): { index: number; variable: SynapseVariable } {
  const index = findVariableIndex(variables, name)
  if (index < 0) throw new Error(`Variable not found: ${name}`)
  const variable = variables[index]
  if (!variable) throw new Error(`Variable not found: ${name}`)
  return { index, variable }
}

function assertNoDuplicate(variables: readonly SynapseVariable[], name: string, allowedExistingName?: string): void {
  const normalized = name.toLowerCase()
  const allowed = allowedExistingName?.toLowerCase()
  const duplicate = variables.some((variable) =>
    variable.name.toLowerCase() === normalized && variable.name.toLowerCase() !== allowed,
  )
  if (duplicate) throw new Error(`Variable already exists: ${name}`)
}

function toRepositoryRef(repository: SynapseRepositoryConfig, activeRepoUuid: string | null): RepositoryRef {
  return {
    uuid: repository.uuid,
    name: repository.name,
    isActive: repository.uuid === activeRepoUuid,
  }
}

function toSafeVariable(variable: SynapseVariable): VariableSafeView {
  return {
    name: variable.name,
    ...(variable.description ? { description: variable.description } : undefined),
    hasValue: variable.value.length > 0,
  }
}
```

- [ ] **Step 5: Implement security and persistence helpers**

Add security, update, and event helpers:

```ts
async function authorizeSecret(
  deps: VariableCapabilityDispatcherDeps,
  action: PermissionAction,
  capabilityAction: string,
  context: DispatchContext,
  repositoryUuid: string,
  variableName: string,
  includeValue: boolean,
): Promise<void> {
  const actor = deps.actor ?? DEFAULT_ACTOR
  const resource = `variable:${repositoryUuid}:${variableName}`
  const metadata = {
    source: context.source ?? "api",
    variableAction: capabilityAction,
    repositoryUuid,
    variableName,
    includeValue,
  }

  if (deps.permissionGuard) {
    const permission = await deps.permissionGuard.check({
      action,
      actor,
      resource,
      context: metadata,
    })
    if (!permission.allowed) {
      deps.auditSink?.record({
        action,
        actor,
        resource,
        outcome: "denied",
        metadata: {
          ...metadata,
          reason: permission.reason,
          policyId: permission.policyId,
        },
      })
      throw new Error(permission.reason)
    }
  }

  deps.auditSink?.record({
    action,
    actor,
    resource,
    outcome: "allowed",
    metadata,
  })
}

async function persistVariables(
  deps: VariableCapabilityDispatcherDeps,
  config: SynapseConfig,
  repository: SynapseRepositoryConfig,
  variables: SynapseVariable[],
): Promise<void> {
  const repositories = config.repositories.map((item) =>
    item.uuid === repository.uuid
      ? { ...item, variables: variables.length > 0 ? variables : undefined }
      : item,
  )
  await deps.updateConfig({ repositories })
  deps.eventBus?.emit({
    domain: "repository",
    type: "repository.updated",
    payload: {
      repositoryUuid: repository.uuid,
      operation: "variables",
      completedAt: new Date().toISOString(),
      message: "变量已更新",
    },
    timestamp: new Date().toISOString(),
  })
}

function variableResponse(config: SynapseConfig, repository: SynapseRepositoryConfig, variable: SynapseVariable) {
  return {
    repository: toRepositoryRef(repository, config.activeRepoUuid),
    variable: toSafeVariable(variable),
  }
}
```

- [ ] **Step 6: Implement read actions**

Add:

```ts
async function listVariables(deps: VariableCapabilityDispatcherDeps, params: Record<string, unknown>): Promise<DispatchResult> {
  const { config, repository } = await resolveRepository(deps, params)
  const variables = (repository.variables ?? []).map(toSafeVariable)
  return {
    ok: true,
    data: {
      repository: toRepositoryRef(repository, config.activeRepoUuid),
      variables,
      total: variables.length,
    },
    total: variables.length,
  }
}

async function getVariable(
  deps: VariableCapabilityDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const name = requireVariableName(params, "name")
  const includeValue = params.includeValue === true
  const { config, repository } = await resolveRepository(deps, params)
  const { variable } = requireExistingVariable(repository.variables ?? [], name)
  if (includeValue) {
    await authorizeSecret(deps, "secret.read", action, context, repository.uuid, variable.name, true)
  }
  return {
    ok: true,
    data: {
      ...variableResponse(config, repository, variable),
      variable: includeValue ? { ...toSafeVariable(variable), value: variable.value } : toSafeVariable(variable),
    },
  }
}
```

- [ ] **Step 7: Implement mutation actions**

Add:

```ts
async function createVariable(
  deps: VariableCapabilityDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const name = requireVariableName(params, "name")
  const value = requireString(params, "value")
  const description = optionalDescription(params)
  const { config, repository } = await resolveRepository(deps, params)
  const variables = [...(repository.variables ?? [])]
  assertNoDuplicate(variables, name)
  const variable: SynapseVariable = {
    name,
    value,
    ...(description ? { description } : undefined),
  }
  await authorizeSecret(deps, "secret.write", action, context, repository.uuid, variable.name, false)
  await persistVariables(deps, config, repository, [...variables, variable])
  return { ok: true, data: { ...variableResponse(config, repository, variable), created: true } }
}

async function updateVariable(
  deps: VariableCapabilityDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const name = requireVariableName(params, "name")
  const hasNewName = Object.prototype.hasOwnProperty.call(params, "newName")
  const hasValue = Object.prototype.hasOwnProperty.call(params, "value")
  const hasDescription = Object.prototype.hasOwnProperty.call(params, "description")
  if (!hasNewName && !hasValue && !hasDescription) throw new Error("No variable fields provided for update")
  const { config, repository } = await resolveRepository(deps, params)
  const variables = [...(repository.variables ?? [])]
  const { index, variable } = requireExistingVariable(variables, name)
  const newName = hasNewName ? requireVariableName(params, "newName") : variable.name
  assertNoDuplicate(variables, newName, variable.name)
  const description = hasDescription ? optionalDescription(params) : variable.description
  const updated: SynapseVariable = {
    name: newName,
    value: hasValue ? requireString(params, "value") : variable.value,
    ...(description ? { description } : undefined),
  }
  variables[index] = updated
  await authorizeSecret(deps, "secret.write", action, context, repository.uuid, variable.name, false)
  await persistVariables(deps, config, repository, variables)
  return { ok: true, data: { ...variableResponse(config, repository, updated), updated: true } }
}

async function upsertVariable(
  deps: VariableCapabilityDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const name = requireVariableName(params, "name")
  const { config, repository } = await resolveRepository(deps, params)
  const variables = [...(repository.variables ?? [])]
  const index = findVariableIndex(variables, name)
  await authorizeSecret(deps, "secret.write", action, context, repository.uuid, name, false)
  if (index < 0) {
    if (!Object.prototype.hasOwnProperty.call(params, "value")) {
      throw new Error("Creating a variable through upsert requires 'value'.")
    }
    const description = optionalDescription(params)
    const created: SynapseVariable = {
      name,
      value: requireString(params, "value"),
      ...(description ? { description } : undefined),
    }
    await persistVariables(deps, config, repository, [...variables, created])
    return { ok: true, data: { ...variableResponse(config, repository, created), created: true, updated: false } }
  }

  const current = variables[index]
  if (!current) throw new Error(`Variable not found: ${name}`)
  const hasValue = Object.prototype.hasOwnProperty.call(params, "value")
  const hasDescription = Object.prototype.hasOwnProperty.call(params, "description")
  const description = hasDescription ? optionalDescription(params) : current.description
  const updated: SynapseVariable = {
    name: current.name,
    value: hasValue ? requireString(params, "value") : current.value,
    ...(description ? { description } : undefined),
  }
  variables[index] = updated
  await persistVariables(deps, config, repository, variables)
  return { ok: true, data: { ...variableResponse(config, repository, updated), created: false, updated: true } }
}

async function deleteVariable(
  deps: VariableCapabilityDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const name = requireVariableName(params, "name")
  const { config, repository } = await resolveRepository(deps, params)
  const variables = [...(repository.variables ?? [])]
  const { index, variable } = requireExistingVariable(variables, name)
  await authorizeSecret(deps, "secret.write", action, context, repository.uuid, variable.name, false)
  variables.splice(index, 1)
  await persistVariables(deps, config, repository, variables)
  return { ok: true, data: { ...variableResponse(config, repository, variable), deleted: true } }
}
```

- [ ] **Step 8: Run variable dispatcher tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/variable-dispatcher.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit variable dispatcher**

```bash
git add desktop/electron/capabilities/variable-dispatcher.ts desktop/electron/capabilities/__tests__/variable-dispatcher.test.ts
git commit -m "feat: add variable capability dispatcher"
```

## Task 4: API/MCP Wiring And Renderer Refresh

**Files:**
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/database/shared/mcp-rpc.ts`
- Modify: `desktop/src/types/repository.ts`
- Modify: `desktop/src/app-shell/config.tsx`
- Modify: `desktop/src/app-shell/__tests__/config.test.tsx`
- Modify: `desktop/tests/unit/database-mcp-rpc.test.ts`

- [ ] **Step 1: Write failing MCP normalization tests**

Add to `desktop/tests/unit/database-mcp-rpc.test.ts`:

```ts
describe("Repository and Variable MCP RPC", () => {
  it("returns repository data without the internal dispatcher envelope", async () => {
    const payload = await callTool("repository_item_list", {
      ok: true,
      data: {
        activeRepositoryUuid: "repo-1",
        repositories: [{ uuid: "repo-1", name: "Main", localPath: "/repo", isActive: true, variableCount: 1 }],
      },
      total: 1,
    })

    expect(payload).toEqual({
      activeRepositoryUuid: "repo-1",
      repositories: [{ uuid: "repo-1", name: "Main", localPath: "/repo", isActive: true, variableCount: 1 }],
    })
  })

  it("returns variable data without the internal dispatcher envelope", async () => {
    const payload = await callTool("variable_item_get", {
      ok: true,
      data: {
        repository: { uuid: "repo-1", name: "Main", isActive: true },
        variable: { name: "TOKEN", hasValue: true },
      },
    })

    expect(payload).toEqual({
      repository: { uuid: "repo-1", name: "Main", isActive: true },
      variable: { name: "TOKEN", hasValue: true },
    })
  })
})
```

- [ ] **Step 2: Write failing AppConfigProvider refresh test**

Update the bridge mock in `desktop/src/app-shell/__tests__/config.test.tsx`:

```ts
const mocks = vi.hoisted(() => ({
  configGet: vi.fn(),
  configUpdate: vi.fn(),
  repositoryUpdatedListener: null as null | ((event: unknown) => void),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))
```

Change `vi.mock("@/lib/electron-bridge", ...)` to include both functions:

```ts
vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    repository: {
      onUpdated: (listener: (event: unknown) => void) => {
        mocks.repositoryUpdatedListener = listener
        return () => { mocks.repositoryUpdatedListener = null }
      },
    },
  }),
  requireSynapseBridge: () => ({
    config: {
      get: mocks.configGet,
      update: mocks.configUpdate,
    },
    repository: {
      onUpdated: (listener: (event: unknown) => void) => {
        mocks.repositoryUpdatedListener = listener
        return () => { mocks.repositoryUpdatedListener = null }
      },
    },
  }),
}))
```

Reset `mocks.repositoryUpdatedListener = null` in `beforeEach`.

Add this test:

```tsx
it("refreshes config when repository variables change outside the renderer", async () => {
  const firstConfig = {
    ...createDefaultConfig(),
    activeRepoUuid: "repo-1",
    repositories: [{
      uuid: "repo-1",
      name: "Repo",
      localPath: "/repo",
      contentDirs: {},
      variables: [{ name: "OLD", value: "old" }],
    }],
  }
  const secondConfig = {
    ...firstConfig,
    repositories: [{
      ...firstConfig.repositories[0],
      variables: [{ name: "NEW", value: "new" }],
    }],
  }
  mocks.configGet
    .mockResolvedValueOnce(firstConfig)
    .mockResolvedValueOnce(secondConfig)

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <AppConfigProvider>
        <VariableProbe />
      </AppConfigProvider>,
    )
    await Promise.resolve()
  })

  expect(container.querySelector("[data-testid='variable-probe']")?.textContent).toBe("OLD")

  await act(async () => {
    mocks.repositoryUpdatedListener?.({
      repositoryUuid: "repo-1",
      operation: "variables",
      completedAt: new Date().toISOString(),
    })
    await Promise.resolve()
  })

  expect(container.querySelector("[data-testid='variable-probe']")?.textContent).toBe("NEW")
})

function VariableProbe() {
  const { config } = useAppConfig()
  return (
    <div data-testid="variable-probe">
      {config.repositories[0]?.variables?.[0]?.name}
    </div>
  )
}
```

- [ ] **Step 3: Run wiring-related tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/database-mcp-rpc.test.ts src/app-shell/__tests__/config.test.tsx
```

Expected: FAIL because MCP normalizer and config subscription are not updated yet.

- [ ] **Step 4: Wire dispatchers into bootstrap**

Modify `desktop/electron/bootstrap/descriptors.ts` imports:

```ts
import { createRepositoryCapabilityDispatcher } from "../capabilities/repository-dispatcher"
import { createVariableCapabilityDispatcher } from "../capabilities/variable-dispatcher"
```

Create dispatchers near the existing content/model price dispatcher setup:

```ts
const repositoryDispatcher = createRepositoryCapabilityDispatcher({
  loadConfig: () => configStore.load(),
})
const variableDispatcher = createVariableCapabilityDispatcher({
  loadConfig: () => configStore.load(),
  updateConfig: (patch) => configStore.update(patch),
  eventBus,
  permissionGuard,
  auditSink,
  actor: { kind: "user", id: "synapse-mcp", display: "Synapse MCP" },
})
```

Pass them to `createSynapseActionRouter`:

```ts
repositoryDispatch: (action, params, context) => repositoryDispatcher.dispatch(action, params, context),
variableDispatch: (action, params, context) => variableDispatcher.dispatch(action, params, context),
```

- [ ] **Step 5: Normalize repository and variable MCP results**

Modify `normalizeToolResult` in `desktop/database/shared/mcp-rpc.ts`:

```ts
if (
  action.startsWith("scheduler.")
  || action.startsWith("workflow.")
  || action.startsWith("content.")
  || action.startsWith("repository.")
  || action.startsWith("variable.")
) {
  return result.data ?? null
}
```

- [ ] **Step 6: Add repository variables operation type**

Modify `desktop/src/types/repository.ts`:

```ts
export type SynapseRepositoryOperationKind = "sync" | "push" | "maintenance" | "initialize" | "disappeared" | "variables"
```

- [ ] **Step 7: Refresh renderer config after variable mutation events**

Modify `desktop/src/app-shell/config.tsx` import:

```ts
import { getSynapseBridge, requireSynapseBridge } from "@/lib/electron-bridge"
```

Add this effect inside `AppConfigProvider` after the initial load effect:

```ts
useEffect(() => {
  const unsubscribe = getSynapseBridge()?.repository?.onUpdated?.((event) => {
    if (event.operation !== "variables") {
      return
    }
    void refreshConfig().catch((refreshError) => {
      logger.error("Failed to refresh app config after variable update.", refreshError)
    })
  })

  return () => {
    unsubscribe?.()
  }
}, [refreshConfig])
```

- [ ] **Step 8: Run wiring-related tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/database-mcp-rpc.test.ts src/app-shell/__tests__/config.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Run API/MCP parity tests again**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/api-mcp-capability-surface.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit wiring and renderer refresh**

```bash
git add desktop/electron/bootstrap/descriptors.ts desktop/database/shared/mcp-rpc.ts desktop/src/types/repository.ts desktop/src/app-shell/config.tsx desktop/src/app-shell/__tests__/config.test.tsx desktop/tests/unit/database-mcp-rpc.test.ts
git commit -m "feat: wire repository variable capabilities"
```

## Task 5: Built-In Skills

**Files:**
- Create: `desktop/resources/templates/skills/synapse-repository-mcp/meta.json`
- Create: `desktop/resources/templates/skills/synapse-repository-mcp/content.md`
- Create: `desktop/resources/templates/skills/synapse-repository-mcp/files/api-reference.md`
- Create: `desktop/resources/templates/skills/synapse-variable-mcp/meta.json`
- Create: `desktop/resources/templates/skills/synapse-variable-mcp/content.md`
- Create: `desktop/resources/templates/skills/synapse-variable-mcp/files/api-reference.md`
- Modify: `desktop/electron/services/__tests__/repository-template-service.test.ts`

- [ ] **Step 1: Write failing built-in skill template test**

Update the expected list in `desktop/electron/services/__tests__/repository-template-service.test.ts`:

```ts
expect(synapseMcpSkills.map((seed) => ({
  icon: seed.icon,
  iconBg: seed.iconBg,
  id: seed.id,
}))).toEqual([
  { id: "synapse-content-mcp", icon: "terminal", iconBg: "teal" },
  { id: "synapse-database-mcp", icon: "terminal", iconBg: "teal" },
  { id: "synapse-model-price-mcp", icon: "terminal", iconBg: "teal" },
  { id: "synapse-repository-mcp", icon: "terminal", iconBg: "teal" },
  { id: "synapse-scheduler-mcp", icon: "terminal", iconBg: "teal" },
  { id: "synapse-variable-mcp", icon: "terminal", iconBg: "teal" },
  { id: "synapse-workflow-mcp", icon: "terminal", iconBg: "teal" },
])
```

- [ ] **Step 2: Run the built-in template test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/repository-template-service.test.ts
```

Expected: FAIL because the two new built-in skill templates do not exist.

- [ ] **Step 3: Create Synapse repository MCP skill metadata**

Create `desktop/resources/templates/skills/synapse-repository-mcp/meta.json`:

```json
{
  "id": "synapse-repository-mcp",
  "name": "synapse-repository-mcp",
  "title": "Synapse 仓库 MCP",
  "usage": "让 AI 查看 Synapse 已配置仓库，并在其它 MCP 技能需要仓库作用域时选择 repositoryUuid。\n\n- **适合**：确认当前激活仓库、按名称或路径查找仓库、为变量等工具选择 repositoryUuid。\n- **会做**：只调用 repository_item_list，返回仓库 uuid、名称、路径、激活状态和变量数量。\n- **限制**：不创建、删除、同步、初始化或修改仓库。",
  "description": "Use when listing configured Synapse repositories through MCP tools.",
  "category": "data",
  "icon": "terminal",
  "iconBg": "teal"
}
```

- [ ] **Step 4: Create Synapse repository MCP skill content**

Create `desktop/resources/templates/skills/synapse-repository-mcp/content.md`:

```md
# Synapse 仓库 MCP

You have access to Synapse Repository MCP tools for discovering configured Synapse repositories.

## Scope Boundary

Use this skill only for configured Synapse repository discovery.

This skill does not create, delete, sync, initialize, maintain, or modify repositories. If the user asks for those operations, say this MCP skill only lists configured repositories.

## Default Flow

1. Call `repository_item_list`.
2. Use `isActive` to identify the current active repository.
3. Use `uuid`, `name`, and `localPath` to disambiguate repositories with similar names.
4. When another Synapse MCP skill needs a repository scope, pass the selected `uuid` as `repositoryUuid`.

## Data Rules

- `variableCount` is only a count. It does not include variable names or values.
- Do not infer variable contents from repository names or paths.
- Do not assume the first repository is active. Use `isActive` or `activeRepositoryUuid`.

## API Reference

See the attached `api-reference.md` for tool signatures and response fields.
```

- [ ] **Step 5: Create Synapse repository MCP API reference**

Create `desktop/resources/templates/skills/synapse-repository-mcp/files/api-reference.md`:

```md
# Synapse 仓库 MCP API Reference

All tools are accessed through the `synapse-mcp` MCP server. Each tool maps to the same canonical Synapse API action.

## Tools

### repository_item_list

Canonical action: `repository.item.list`

Input:

```json
{}
```

Returns:

```json
{
  "activeRepositoryUuid": "repo-1",
  "repositories": [
    {
      "uuid": "repo-1",
      "name": "Main",
      "localPath": "/Users/me/SynapseContent",
      "isActive": true,
      "variableCount": 2
    }
  ]
}
```

Fields:

- `activeRepositoryUuid`: current active repository uuid, or `null`.
- `repositories[].uuid`: pass this as `repositoryUuid` to repository-scoped MCP tools.
- `repositories[].name`: display name.
- `repositories[].localPath`: local folder path.
- `repositories[].isActive`: whether this repository is currently active in Synapse.
- `repositories[].variableCount`: number of local variables configured for this repository.

## Boundaries

This tool is read-only. It does not expose variable names or values and cannot modify repository configuration.
```

- [ ] **Step 6: Create Synapse variable MCP skill metadata**

Create `desktop/resources/templates/skills/synapse-variable-mcp/meta.json`:

```json
{
  "id": "synapse-variable-mcp",
  "name": "synapse-variable-mcp",
  "title": "Synapse 变量 MCP",
  "usage": "让 AI 管理 Synapse 仓库本机变量：查看变量名、按需读取单个值、创建、更新、upsert 或删除变量。\n\n- **适合**：维护 ${{ NAME }} 占位符使用的本机变量、为当前或指定仓库保存 token/配置值。\n- **会做**：仓库不明确时先查 repository_item_list；默认不读取明文；设置变量优先用 upsert。\n- **限制**：不批量读取所有变量值，不把 token/secret 明文复述到回答里。",
  "description": "Use when managing Synapse repository-scoped local variables through MCP tools.",
  "category": "data",
  "icon": "terminal",
  "iconBg": "teal"
}
```

- [ ] **Step 7: Create Synapse variable MCP skill content**

Create `desktop/resources/templates/skills/synapse-variable-mcp/content.md`:

```md
# Synapse 变量 MCP

You have access to Synapse Variable MCP tools for managing repository-scoped local variables used by `${{ NAME }}` placeholders.

## Scope Boundary

Use this skill only for Synapse local variables stored on configured repositories.

Do not use this skill for Database rows, Scheduler tasks, Workflow variables, Content publishing, provider settings, shell environment variables, or editor installation.

## Repository Scope

Every variable tool accepts optional `repositoryUuid`.

- If the user names a repository or the target repository is unclear, call `repository_item_list` first.
- Pass the selected repository `uuid` as `repositoryUuid`.
- Omit `repositoryUuid` only when using the current active repository is acceptable.
- Never assume the first repository is the target.

## Default Flow

1. Use `variable_item_list` to inspect variable names and descriptions without values.
2. Use `variable_item_get` without `includeValue` when you need one variable's metadata.
3. Use `variable_item_get` with `includeValue: true` only when the user explicitly needs the stored value.
4. Use `variable_item_upsert` when the user asks to set a variable and does not care whether it already exists.
5. Use `variable_item_create` only when the user wants creation to fail if the variable already exists.
6. Use `variable_item_update` when the variable must already exist or when renaming with `newName`.
7. Use `variable_item_delete` only after the repository and variable name are clear.

## Sensitive Value Rules

- `variable_item_list` never returns values.
- Mutation tools never return values.
- Do not repeat token, password, secret, credential, API key, cookie, or authorization values in your final answer.
- After writing a value, report the variable name, repository, and operation result only.
- If you read a value with `includeValue: true`, use it only for the user's requested operation.

## Name Rules

Variable names must contain only letters, digits, and underscores. Names are matched case-insensitively within one repository.

## API Reference

See the attached `api-reference.md` for tool signatures, fields, and common flows.
```

- [ ] **Step 8: Create Synapse variable MCP API reference**

Create `desktop/resources/templates/skills/synapse-variable-mcp/files/api-reference.md`:

````md
# Synapse 变量 MCP API Reference

All tools are accessed through the `synapse-mcp` MCP server. Each tool maps to the same canonical Synapse API action.

## Shared Field

Every tool accepts optional `repositoryUuid`:

```json
{ "repositoryUuid": "repo-1" }
```

Omit it to use the current active repository.

## Safe Variable View

Tools return this safe view unless `variable_item_get` is called with `includeValue: true`:

```json
{
  "name": "GITEE_TOKEN",
  "description": "gitee 操作用的 token",
  "hasValue": true
}
```

`hasValue` says whether the stored value is a non-empty string.

## Tools

### variable_item_list

Canonical action: `variable.item.list`

Input:

```json
{
  "repositoryUuid": "repo-1"
}
```

Returns:

```json
{
  "repository": { "uuid": "repo-1", "name": "Main", "isActive": true },
  "variables": [
    { "name": "GITEE_TOKEN", "description": "gitee 操作用的 token", "hasValue": true }
  ],
  "total": 1
}
```

This tool never returns values.

### variable_item_get

Canonical action: `variable.item.get`

Input without value:

```json
{
  "repositoryUuid": "repo-1",
  "name": "GITEE_TOKEN"
}
```

Input with value:

```json
{
  "repositoryUuid": "repo-1",
  "name": "GITEE_TOKEN",
  "includeValue": true
}
```

Use `includeValue: true` only when the user explicitly needs the stored value.

### variable_item_create

Canonical action: `variable.item.create`

Input:

```json
{
  "repositoryUuid": "repo-1",
  "name": "BARK_ID",
  "value": "example-value",
  "description": "手机消息推送使用"
}
```

Fails if a variable with the same name already exists, case-insensitively.

### variable_item_update

Canonical action: `variable.item.update`

Input:

```json
{
  "repositoryUuid": "repo-1",
  "name": "BARK_ID",
  "newName": "BARK_TOKEN",
  "value": "replacement-value",
  "description": "手机消息推送使用"
}
```

Only provided fields change. Pass `description: ""` to clear the description.

### variable_item_upsert

Canonical action: `variable.item.upsert`

Input:

```json
{
  "repositoryUuid": "repo-1",
  "name": "BARK_ID",
  "value": "example-value",
  "description": "手机消息推送使用"
}
```

Creates the variable if missing, or updates provided fields if it already exists. Creating through upsert requires `value`.

### variable_item_delete

Canonical action: `variable.item.delete`

Input:

```json
{
  "repositoryUuid": "repo-1",
  "name": "BARK_ID"
}
```

Deletes one variable and returns only the safe variable view.

## Common Flows

### Set a variable in the active repository

1. Call `variable_item_upsert` without `repositoryUuid`.
2. Report the variable name and whether it was created or updated.
3. Do not include the value in the response.

### Set a variable in a named repository

1. Call `repository_item_list`.
2. Match the repository by `name` or `localPath`.
3. Call `variable_item_upsert` with that repository's `uuid`.
4. Report the repository name, variable name, and result.

### Read a value

1. Confirm the user needs the stored value.
2. Call `variable_item_get` with `includeValue: true`.
3. Use the value for the requested task.
4. Do not repeat the value in the final answer unless the user explicitly asked to see it.
````

- [ ] **Step 9: Run JSON parse and template tests**

Run:

```bash
node -e 'JSON.parse(require("fs").readFileSync("desktop/resources/templates/skills/synapse-repository-mcp/meta.json","utf8")); JSON.parse(require("fs").readFileSync("desktop/resources/templates/skills/synapse-variable-mcp/meta.json","utf8"))'
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/repository-template-service.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit built-in skills**

```bash
git add desktop/resources/templates/skills/synapse-repository-mcp desktop/resources/templates/skills/synapse-variable-mcp desktop/electron/services/__tests__/repository-template-service.test.ts
git commit -m "feat: add repository variable mcp skills"
```

## Task 6: Documentation And Release Notes

**Files:**
- Modify: `docs/reference/capability-naming-matrix.md`
- Modify: `website/developer/capability-naming-matrix.md`
- Modify: `website/reference/synapse-mcp-capabilities.md`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update capability matrices**

Add these rows to both `docs/reference/capability-naming-matrix.md` and `website/developer/capability-naming-matrix.md` after the model price rows if present, otherwise after database rows:

```md
| `repository.item.list` | `repository_item_list` | `repository.item.list` | `repositoryItemList` |
| `variable.item.list` | `variable_item_list` | `variable.item.list` | `variableItemList` |
| `variable.item.get` | `variable_item_get` | `variable.item.get` | `variableItemGet` |
| `variable.item.create` | `variable_item_create` | `variable.item.create` | `variableItemCreate` |
| `variable.item.update` | `variable_item_update` | `variable.item.update` | `variableItemUpdate` |
| `variable.item.upsert` | `variable_item_upsert` | `variable.item.upsert` | `variableItemUpsert` |
| `variable.item.delete` | `variable_item_delete` | `variable.item.delete` | `variableItemDelete` |
```

- [ ] **Step 2: Update website MCP capability reference**

Modify `website/reference/synapse-mcp-capabilities.md` source list:

```md
- `desktop/synapse-capabilities/shared/repository-domain.ts`
- `desktop/synapse-capabilities/shared/variable-domain.ts`
```

Add rows to the current domain table:

```md
| `repository` | 已配置 Synapse 仓库发现 | `desktop/synapse-capabilities/shared/repository-domain.ts` |
| `variable` | 仓库本机变量的查询、写入和删除 | `desktop/synapse-capabilities/shared/variable-domain.ts` |
```

Add a section before "新增或修改能力":

```md
## Repository And Variable MCP

Repository MCP 第一版只提供只读仓库发现。Variable MCP 管理仓库本机变量，变量值默认不返回；只有单个变量读取显式传 `includeValue: true` 时才会返回明文。
```

- [ ] **Step 3: Update release notes**

Modify `RELEASE_NOTES_PENDING.md` under `## 新增功能`:

```md
- Synapse MCP 新增仓库发现和本机变量管理能力，AI 可以在指定仓库中安全地增删改查变量；变量列表和写入结果默认不返回敏感值。
```

- [ ] **Step 4: Run docs-related tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/api-mcp-capability-surface.test.ts
```

Expected: PASS, including docs checks for retired CLI wording.

- [ ] **Step 5: Commit docs and release notes**

```bash
git add docs/reference/capability-naming-matrix.md website/developer/capability-naming-matrix.md website/reference/synapse-mcp-capabilities.md RELEASE_NOTES_PENDING.md
git commit -m "docs: document repository variable mcp"
```

## Task 7: Final Verification

**Files:**
- No new files.
- Verify all files touched in previous tasks.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts tests/unit/api-mcp-capability-surface.test.ts tests/unit/database-mcp-rpc.test.ts electron/capabilities/__tests__/repository-dispatcher.test.ts electron/capabilities/__tests__/variable-dispatcher.test.ts electron/services/__tests__/repository-template-service.test.ts src/app-shell/__tests__/config.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS. This is important because the implementation touches Electron capability wiring and must not introduce bare IPC or business data file writes.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: Only files from this plan are changed after the final task commits. If previous task commits were made, `git status --short` should be empty.

- [ ] **Step 5: Record final verification result**

If every command above passes, no extra commit is needed. If verification fixes were required, commit them:

```bash
git status --short
git add desktop/electron/capabilities/variable-dispatcher.ts desktop/electron/capabilities/__tests__/variable-dispatcher.test.ts
git commit -m "test: verify repository variable mcp"
```

The `git add` command above is the expected verification-fix case if only variable dispatcher typing or test assertions need correction. If `git status --short` shows different files, stage the exact changed files from that output instead of using a broad add.
