# Editor and Agent Definition Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Synapse definitions into explicit `editor` and `agent` systems, then drive Agent runtime creation, mode lists, provider env mapping, and settings readiness from those definitions.

**Architecture:** Move existing editor/product definitions from `desktop/src/ide-definitions` to `desktop/src/definitions/editor`, add `desktop/src/definitions/agent` for Codex and Claude Code runtime metadata, and generate renderer/main registries from both systems. Renderer imports metadata only; Electron imports adapter factories, env builders, and status services from the main registry.

**Tech Stack:** Electron, React, TypeScript, Vitest, pnpm, shadcn/ui, Tailwind CSS.

---

## Execution Notes

- Start from repo root: `/Users/liyang/Documents/code/github/Synapse`.
- Do not start a dev server, Electron runtime, browser preview, Playwright, or Chrome DevTools during this implementation.
- Before executing, inspect `git status --short`. The current workspace had unrelated Agent UI edits when this plan was written:
  - `desktop/src/modules/agent/index.tsx`
  - `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`
  - `desktop/src/modules/agent/__tests__/agent-message-row.test.tsx`
- Do not revert, reformat, stage, or commit those unrelated files unless the user explicitly includes them in the task.
- Use `apply_patch` for manual file edits. Use `git mv` for moves.

## Target File Structure

Create or migrate to this structure:

```text
desktop/src/definitions/
  types.ts
  main-types.ts
  editor/
    cursor/
    windsurf/
    codex/
    claude-code/
    __tests__/
    shared-rule-scanners.ts
    shared-rule-section.ts
    shared-skill-directory.ts
    shared-skill-frontmatter.ts
    shared-yaml-scalar.ts
  agent/
    codex/
      agent.ts
      agent-main.ts
    claude-code/
      agent.ts
      agent-main.ts
  generated/
    renderer-registry.ts
desktop/electron/services/definitions/
  generated/
    main-registry.ts
```

Remove these old product-definition paths once imports are migrated:

```text
desktop/src/ide-definitions/
desktop/electron/services/ide-definitions/
```

Keep the existing data-store CLI code. It is separate from Agent runtime readiness.

---

### Task 1: Move Editor Definitions To `definitions/editor`

**Files:**
- Move: `desktop/src/ide-definitions/*` -> `desktop/src/definitions/editor/*`
- Move: `desktop/src/ide-definitions/types.ts` -> `desktop/src/definitions/types.ts`
- Move: `desktop/src/ide-definitions/main-types.ts` -> `desktop/src/definitions/main-types.ts`
- Move: `desktop/electron/services/ide-definitions/generated/main-registry.ts` -> `desktop/electron/services/definitions/generated/main-registry.ts`
- Modify: `desktop/src/definitions/types.ts`
- Modify: `desktop/src/definitions/main-types.ts`
- Modify imports across `desktop/src/` and `desktop/electron/`
- Test: `desktop/src/definitions/editor/__tests__/shared-rule-section.test.ts`

- [ ] **Step 1: Move the directories**

```bash
mkdir -p desktop/src/definitions/editor
git mv desktop/src/ide-definitions/cursor desktop/src/definitions/editor/cursor
git mv desktop/src/ide-definitions/windsurf desktop/src/definitions/editor/windsurf
git mv desktop/src/ide-definitions/codex desktop/src/definitions/editor/codex
git mv desktop/src/ide-definitions/claude-code desktop/src/definitions/editor/claude-code
git mv desktop/src/ide-definitions/__tests__ desktop/src/definitions/editor/__tests__
git mv desktop/src/ide-definitions/shared-rule-scanners.ts desktop/src/definitions/editor/shared-rule-scanners.ts
git mv desktop/src/ide-definitions/shared-rule-section.ts desktop/src/definitions/editor/shared-rule-section.ts
git mv desktop/src/ide-definitions/shared-skill-directory.ts desktop/src/definitions/editor/shared-skill-directory.ts
git mv desktop/src/ide-definitions/shared-skill-frontmatter.ts desktop/src/definitions/editor/shared-skill-frontmatter.ts
git mv desktop/src/ide-definitions/shared-yaml-scalar.ts desktop/src/definitions/editor/shared-yaml-scalar.ts
git mv desktop/src/ide-definitions/types.ts desktop/src/definitions/types.ts
git mv desktop/src/ide-definitions/main-types.ts desktop/src/definitions/main-types.ts
git mv desktop/src/ide-definitions/generated desktop/src/definitions/generated
mkdir -p desktop/electron/services/definitions/generated
git mv desktop/electron/services/ide-definitions/generated/main-registry.ts desktop/electron/services/definitions/generated/main-registry.ts
```

Expected: `git status --short` shows renamed files under `desktop/src/definitions` and `desktop/electron/services/definitions`.

- [ ] **Step 2: Rename editor metadata files**

```bash
git mv desktop/src/definitions/editor/cursor/ide.ts desktop/src/definitions/editor/cursor/editor.ts
git mv desktop/src/definitions/editor/windsurf/ide.ts desktop/src/definitions/editor/windsurf/editor.ts
git mv desktop/src/definitions/editor/codex/ide.ts desktop/src/definitions/editor/codex/editor.ts
git mv desktop/src/definitions/editor/claude-code/ide.ts desktop/src/definitions/editor/claude-code/editor.ts
```

Expected: no `desktop/src/definitions/editor/*/ide.ts` files remain.

- [ ] **Step 3: Rename editor definition type and exports**

In `desktop/src/definitions/types.ts`, rename:

```ts
export type SynapseIdeDefinition = {
```

to:

```ts
export type SynapseEditorDefinition = {
```

In each `desktop/src/definitions/editor/*/editor.ts`, use this exact pattern:

```ts
import type { SynapseEditorDefinition } from "../../types"

export const editorDefinition = {
  id: "codex",
  label: "Codex",
  order: 20,
  icon: codexIcon,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
} as const satisfies SynapseEditorDefinition
```

Keep each editor's existing `id`, `label`, `order`, `icon`, support flags, and content types.

- [ ] **Step 4: Update imports for moved shared editor files**

Run:

```bash
rg -l 'ide-definitions' desktop/src desktop/electron | xargs perl -pi -e 's#ide-definitions#definitions#g'
rg -l 'SynapseIdeDefinition' desktop/src desktop/electron | xargs perl -pi -e 's#SynapseIdeDefinition#SynapseEditorDefinition#g'
rg -l 'ideDefinition' desktop/src/definitions desktop/electron | xargs perl -pi -e 's#ideDefinition#editorDefinition#g'
rg -l 'IdeDefinition' desktop/src/definitions desktop/electron | xargs perl -pi -e 's#IdeDefinition#EditorDefinition#g'
```

Then fix relative imports inside `desktop/src/definitions/editor/*`:

```text
../types      -> ../../types
../main-types -> ../../main-types
```

Expected:

```bash
rg -n 'ide-definitions|SynapseIdeDefinition|ideDefinition|IdeDefinition' desktop/src desktop/electron
```

prints no matches.

- [ ] **Step 5: Update editor icon and renderer registry imports**

In `desktop/src/lib/editor-icons.ts`, import from the new registry and variable name:

```ts
import { editorDefinitions } from "@/definitions/generated/renderer-registry"

const editorIconMap = new Map<string, string>(
  editorDefinitions.map((definition) => [definition.id, definition.icon]),
)
```

In `desktop/src/lib/editor-registry.ts`, import from the new registry and export editor definitions:

```ts
import { editorDefinitions } from "@/definitions/generated/renderer-registry"

export { editorDefinitions }
```

Preserve all existing exported helper names in those files unless no consumer uses them.

- [ ] **Step 6: Run the moved editor test**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/definitions/editor/__tests__/shared-rule-section.test.ts
```

Expected: the test passes.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/definitions desktop/electron/services/definitions desktop/src/lib/editor-icons.ts desktop/src/lib/editor-registry.ts
git commit -m "refactor: move editor definitions"
```

Expected: commit succeeds and unrelated Agent UI files remain unstaged.

---

### Task 2: Replace The Definition Generator

**Files:**
- Move: `desktop/scripts/generate-ide-registry.mjs` -> `desktop/scripts/generate-definitions-registry.mjs`
- Modify: `desktop/package.json`
- Modify: `desktop/scripts/generate-definitions-registry.mjs`
- Generated: `desktop/src/definitions/generated/renderer-registry.ts`
- Generated: `desktop/electron/services/definitions/generated/main-registry.ts`
- Test: `desktop/src/definitions/__tests__/editor-registry.test.ts`

- [ ] **Step 1: Write the failing renderer registry test**

Create `desktop/src/definitions/__tests__/editor-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  editorDefinitions,
  installFormDefinitionByEditorId,
  mcpDefinitions,
} from "../generated/renderer-registry"

describe("editor definition registry", () => {
  it("exports sorted editor metadata for all supported editors", () => {
    expect(editorDefinitions.map((definition) => definition.id)).toEqual([
      "cursor",
      "codex",
      "claude-code",
      "windsurf",
    ])
  })

  it("keeps MCP and install form metadata renderer-safe", () => {
    expect(mcpDefinitions.map((definition) => definition.target)).toEqual([
      "claude-code",
      "cursor",
      "codex",
      "windsurf",
    ])
    expect(installFormDefinitionByEditorId.has("cursor")).toBe(true)
    expect(installFormDefinitionByEditorId.has("windsurf")).toBe(true)
    expect(installFormDefinitionByEditorId.has("claude-code")).toBe(true)
  })
})
```

- [ ] **Step 2: Verify it fails before generator update**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/definitions/__tests__/editor-registry.test.ts
```

Expected: FAIL because `editorDefinitions` is not exported yet.

- [ ] **Step 3: Rename the script and update package scripts**

```bash
git mv desktop/scripts/generate-ide-registry.mjs desktop/scripts/generate-definitions-registry.mjs
```

In `desktop/package.json`, replace every `generate-ide-registry.mjs` reference with:

```text
generate-definitions-registry.mjs
```

Rename script key:

```json
"generate:definitions-registry": "node scripts/generate-definitions-registry.mjs"
```

Update script consumers:

```json
"build": "pnpm generate:definitions-registry && pnpm build:renderer && pnpm build:electron && pnpm build:data-store",
"typecheck": "pnpm generate:definitions-registry && tsc -p tsconfig.json --noEmit && tsc -p tsconfig.electron.json --noEmit && tsc -p tsconfig.test.json --noEmit"
```

Keep existing dev scripts equivalent, using `node scripts/generate-definitions-registry.mjs`.

- [ ] **Step 4: Update the generator constants**

In `desktop/scripts/generate-definitions-registry.mjs`, use these roots:

```js
const definitionsRoot = path.join(packageRoot, "src", "definitions")
const editorDefinitionsRoot = path.join(definitionsRoot, "editor")
const agentDefinitionsRoot = path.join(definitionsRoot, "agent")
const rendererGeneratedDir = path.join(definitionsRoot, "generated")
const mainGeneratedDir = path.join(packageRoot, "electron", "services", "definitions", "generated")
```

Rename `listDefinitionDirectories()` to `listEditorDefinitionDirectories()` and scan for `editor.ts`.

- [ ] **Step 5: Update renderer registry rendering for editors**

Renderer imports should look like:

```ts
import { editorDefinition as codexEditorDefinition } from "../editor/codex/editor"
```

Renderer type import should be:

```ts
import type {
  SynapseCliDefinition,
  SynapseEditorDefinition,
  SynapseInstallFormDefinition,
  SynapseRendererMcpDefinition,
} from "../types"
```

Renderer export should be:

```ts
export const editorDefinitions = [
  cursorEditorDefinition,
  codexEditorDefinition,
  claudeCodeEditorDefinition,
  windsurfEditorDefinition,
].sort((left, right) => left.order - right.order) satisfies SynapseEditorDefinition[]
```

Keep `cliDefinitions` temporarily in this task so the existing CLI status code continues compiling. It will be removed after Agent runtime status replaces it.

- [ ] **Step 6: Update main registry rendering for editors**

Main imports should look like:

```ts
import { editorAdapter as codexEditorAdapter } from "../../../../src/definitions/editor/codex/adapter"
import { installStrategy as codexInstallStrategy } from "../../../../src/definitions/editor/codex/install"
import { scanStrategy as codexScanStrategy } from "../../../../src/definitions/editor/codex/scan"
```

Main type imports should be:

```ts
import type {
  EditorAdapter,
  EditorInstallStrategy,
  EditorScanStrategy,
} from "../../../../src/definitions/main-types"
import type { SynapseMcpDefinition } from "../../../../src/definitions/types"
```

- [ ] **Step 7: Generate registries**

Run:

```bash
pnpm --filter @synapse/desktop run generate:definitions-registry
```

Expected: `desktop/src/definitions/generated/renderer-registry.ts` exports `editorDefinitions`; `desktop/electron/services/definitions/generated/main-registry.ts` imports from `src/definitions/editor`.

- [ ] **Step 8: Verify the registry test passes**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/definitions/__tests__/editor-registry.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/package.json desktop/scripts/generate-definitions-registry.mjs desktop/src/definitions desktop/electron/services/definitions
git commit -m "refactor: generate editor definitions registry"
```

Expected: commit succeeds.

---

### Task 3: Add Renderer-Safe Agent Definitions

**Files:**
- Modify: `desktop/src/definitions/types.ts`
- Create: `desktop/src/definitions/agent/codex/agent.ts`
- Create: `desktop/src/definitions/agent/claude-code/agent.ts`
- Modify: `desktop/scripts/generate-definitions-registry.mjs`
- Generated: `desktop/src/definitions/generated/renderer-registry.ts`
- Test: `desktop/src/definitions/__tests__/agent-registry.test.ts`

- [ ] **Step 1: Write the failing agent registry test**

Create `desktop/src/definitions/__tests__/agent-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { agentDefinitions } from "../generated/renderer-registry"

describe("agent definition registry", () => {
  it("exports sorted renderer-safe Agent runtime metadata", () => {
    expect(agentDefinitions.map((definition) => definition.id)).toEqual([
      "claude-code",
      "codex",
    ])
  })

  it("declares local CLI dependencies and mode lists", () => {
    const claude = agentDefinitions.find((definition) => definition.id === "claude-code")
    const codex = agentDefinitions.find((definition) => definition.id === "codex")

    expect(claude?.runtime).toEqual({ kind: "local-cli", binaries: ["claude"] })
    expect(claude?.modes.map((mode) => mode.key)).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "auto",
      "bypassPermissions",
      "dontAsk",
    ])
    expect(codex?.runtime).toEqual({ kind: "local-cli", binaries: ["codex"] })
    expect(codex?.modes.map((mode) => mode.key)).toEqual([
      "suggest",
      "auto-edit",
      "full-auto",
      "yolo",
    ])
  })
})
```

- [ ] **Step 2: Verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/definitions/__tests__/agent-registry.test.ts
```

Expected: FAIL because `agentDefinitions` does not exist.

- [ ] **Step 3: Add agent metadata types**

Append these types to `desktop/src/definitions/types.ts`:

```ts
export type SynapseAgentModeOption = {
  key: string
  label: string
}

export type SynapseAgentRuntimeRequirement = {
  kind: "local-cli"
  binaries: readonly string[]
}

export type SynapseAgentCapabilities = {
  chat: boolean
  projectContext: boolean
  permissions: boolean
  mcp: boolean
}

export type SynapseAgentDefinition = {
  id: string
  label: string
  order: number
  relatedEditorId?: string
  runtime: SynapseAgentRuntimeRequirement
  modes: readonly SynapseAgentModeOption[]
  capabilities: SynapseAgentCapabilities
}
```

- [ ] **Step 4: Create Codex agent metadata**

Create `desktop/src/definitions/agent/codex/agent.ts`:

```ts
import type { SynapseAgentDefinition } from "../../types"

export const agentDefinition = {
  id: "codex",
  label: "Codex",
  order: 20,
  relatedEditorId: "codex",
  runtime: {
    kind: "local-cli",
    binaries: ["codex"],
  },
  modes: [
    { key: "suggest", label: "Suggest" },
    { key: "auto-edit", label: "Auto Edit" },
    { key: "full-auto", label: "Full Auto" },
    { key: "yolo", label: "YOLO" },
  ],
  capabilities: {
    chat: true,
    projectContext: true,
    permissions: true,
    mcp: true,
  },
} as const satisfies SynapseAgentDefinition
```

- [ ] **Step 5: Create Claude Code agent metadata**

Create `desktop/src/definitions/agent/claude-code/agent.ts`:

```ts
import type { SynapseAgentDefinition } from "../../types"

export const agentDefinition = {
  id: "claude-code",
  label: "Claude Code",
  order: 10,
  relatedEditorId: "claude-code",
  runtime: {
    kind: "local-cli",
    binaries: ["claude"],
  },
  modes: [
    { key: "default", label: "Default" },
    { key: "acceptEdits", label: "Accept Edits" },
    { key: "plan", label: "Plan" },
    { key: "auto", label: "Auto" },
    { key: "bypassPermissions", label: "Bypass Permissions" },
    { key: "dontAsk", label: "Don't Ask" },
  ],
  capabilities: {
    chat: true,
    projectContext: true,
    permissions: true,
    mcp: true,
  },
} as const satisfies SynapseAgentDefinition
```

- [ ] **Step 6: Update generator to scan agent metadata**

In `desktop/scripts/generate-definitions-registry.mjs`, add a `listAgentDefinitionDirectories()` function that scans `agentDefinitionsRoot` for `agent.ts`.

Renderer imports should look like:

```ts
import { agentDefinition as codexAgentDefinition } from "../agent/codex/agent"
```

Renderer type import should include:

```ts
SynapseAgentDefinition
```

Renderer export should be:

```ts
export const agentDefinitions = [
  claudeCodeAgentDefinition,
  codexAgentDefinition,
].sort((left, right) => left.order - right.order) satisfies SynapseAgentDefinition[]
```

- [ ] **Step 7: Generate and test**

Run:

```bash
pnpm --filter @synapse/desktop run generate:definitions-registry
pnpm --filter @synapse/desktop test -- desktop/src/definitions/__tests__/agent-registry.test.ts
```

Expected: both commands pass.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/definitions desktop/scripts/generate-definitions-registry.mjs
git commit -m "feat: add agent runtime definitions"
```

Expected: commit succeeds.

---

### Task 4: Add Main-Side Agent Runtime Definitions

**Files:**
- Modify: `desktop/src/definitions/main-types.ts`
- Create: `desktop/src/definitions/agent/codex/agent-main.ts`
- Create: `desktop/src/definitions/agent/claude-code/agent-main.ts`
- Modify: `desktop/scripts/generate-definitions-registry.mjs`
- Generated: `desktop/electron/services/definitions/generated/main-registry.ts`
- Test: `desktop/electron/services/definitions/__tests__/agent-runtime-registry.test.ts`

- [ ] **Step 1: Write the failing main registry test**

Create `desktop/electron/services/definitions/__tests__/agent-runtime-registry.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import {
  agentRuntimeDefinitionById,
  agentRuntimeDefinitions,
} from "../generated/main-registry"

describe("agent runtime main registry", () => {
  it("exports Codex and Claude Code runtime definitions", () => {
    expect(agentRuntimeDefinitions.map((definition) => definition.id)).toEqual([
      "claude-code",
      "codex",
    ])
    expect(agentRuntimeDefinitionById.get("codex")?.runtime.binaries).toEqual(["codex"])
    expect(agentRuntimeDefinitionById.get("claude-code")?.runtime.binaries).toEqual(["claude"])
  })

  it("creates adapters with the expected agent types", () => {
    const runner = {
      run: vi.fn(),
      start: vi.fn(),
    }
    const codex = agentRuntimeDefinitionById.get("codex")?.createAdapter({
      projectId: "project-1",
      agentType: "codex",
      providers: [],
      env: {},
      envAllowlist: [],
    }, runner)
    const claude = agentRuntimeDefinitionById.get("claude-code")?.createAdapter({
      projectId: "project-1",
      agentType: "claude-code",
      providers: [],
      env: {},
      envAllowlist: [],
    }, runner)

    expect(codex?.agentType).toBe("codex")
    expect(claude?.agentType).toBe("claude-code")
  })
})
```

- [ ] **Step 2: Verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/definitions/__tests__/agent-runtime-registry.test.ts
```

Expected: FAIL because `agentRuntimeDefinitions` is not exported.

- [ ] **Step 3: Add main runtime definition types**

Add the imports at the top of `desktop/src/definitions/main-types.ts` and append the type declarations after `EditorScanStrategy`:

```ts
import type { AgentAdapter } from "../../electron/services/agent-runtime/types"
import type {
  CodexProcessRunner,
} from "../../electron/services/agent-runtime/adapters/codex-exec"
import type {
  ClaudeProcessRunner,
} from "../../electron/services/agent-runtime/adapters/claude-code"
import type {
  ProviderConfigView,
  ProviderRuntimeView,
} from "../../electron/services/provider-config/types"
import type { SynapseAgentDefinition } from "./types"

export type AgentRuntimeProcessRunner = CodexProcessRunner & ClaudeProcessRunner

export type AgentRuntimeEnvInput = {
  readonly provider?: ProviderConfigView
  readonly apiKey?: string
  readonly model?: string
}

export type AgentRuntimeEnvResult = {
  readonly env: Record<string, string | undefined>
  readonly extraEnvAllowlist?: readonly string[]
}

export type AgentRuntimeDefinition = SynapseAgentDefinition & {
  createAdapter(
    view: ProviderRuntimeView,
    runner: AgentRuntimeProcessRunner,
  ): AgentAdapter
  buildEnv(input: AgentRuntimeEnvInput): AgentRuntimeEnvResult
}
```

If import order linting complains, keep the existing imports at the top and group these type imports with them.

- [ ] **Step 4: Create Codex main definition**

Create `desktop/src/definitions/agent/codex/agent-main.ts`:

```ts
import { CodexExecAdapter } from "../../../../electron/services/agent-runtime/adapters/codex-exec"
import type { AgentRuntimeDefinition } from "../../main-types"
import { agentDefinition } from "./agent"

export const agentRuntimeDefinition = {
  ...agentDefinition,
  createAdapter(view, runner) {
    return new CodexExecAdapter(runner, {
      model: view.model,
      provider: view.provider?.id,
      baseUrl: view.baseUrl,
      effort: view.provider?.effort,
      mode: view.mode,
      backend: "app-server",
      env: {
        ...view.env,
        CODEX_HOME: view.provider?.codex?.codexHome ?? view.env.CODEX_HOME,
      },
      envAllowlist: [
        ...view.envAllowlist,
        ...(view.provider?.codex?.codexHome ? ["CODEX_HOME"] : []),
      ],
    })
  },
  buildEnv({ provider, apiKey }) {
    if (!provider) return { env: {} }
    const env: Record<string, string | undefined> = {}
    if (apiKey) env.OPENAI_API_KEY = apiKey
    if (provider.baseUrl) env.OPENAI_BASE_URL = provider.baseUrl
    return { env: { ...env, ...provider.env } }
  },
} satisfies AgentRuntimeDefinition
```

- [ ] **Step 5: Create Claude Code main definition**

Create `desktop/src/definitions/agent/claude-code/agent-main.ts`:

```ts
import { ClaudeCodeAdapter } from "../../../../electron/services/agent-runtime/adapters/claude-code"
import type { AgentRuntimeDefinition } from "../../main-types"
import { agentDefinition } from "./agent"

export const agentRuntimeDefinition = {
  ...agentDefinition,
  createAdapter(view, runner) {
    return new ClaudeCodeAdapter(runner, {
      model: view.model,
      effort: view.provider?.effort,
      mode: view.mode,
      env: view.env,
      envAllowlist: view.envAllowlist,
    })
  },
  buildEnv({ provider, apiKey, model }) {
    if (!provider) return { env: {} }
    const env: Record<string, string | undefined> = {}
    if (provider.baseUrl) {
      env.ANTHROPIC_BASE_URL = provider.baseUrl
      if (apiKey) {
        env.ANTHROPIC_AUTH_TOKEN = apiKey
        env.ANTHROPIC_API_KEY = ""
      }
    } else if (apiKey) {
      env.ANTHROPIC_API_KEY = apiKey
    }
    if (model) env.ANTHROPIC_MODEL = model
    return { env: { ...env, ...provider.env } }
  },
} satisfies AgentRuntimeDefinition
```

- [ ] **Step 6: Update generator main registry for agents**

In `desktop/scripts/generate-definitions-registry.mjs`, scan `agent-main.ts` files separately from `agent.ts`.

Main imports should look like:

```ts
import { agentRuntimeDefinition as codexAgentRuntimeDefinition } from "../../../../src/definitions/agent/codex/agent-main"
```

Main type import should include:

```ts
AgentRuntimeDefinition
```

Main exports should include:

```ts
export const agentRuntimeDefinitions = [
  claudeCodeAgentRuntimeDefinition,
  codexAgentRuntimeDefinition,
].sort((left, right) => left.order - right.order) satisfies AgentRuntimeDefinition[]

export const agentRuntimeDefinitionById = new Map(
  agentRuntimeDefinitions.map((definition) => [definition.id, definition]),
)
```

- [ ] **Step 7: Generate and test**

Run:

```bash
pnpm --filter @synapse/desktop run generate:definitions-registry
pnpm --filter @synapse/desktop test -- desktop/electron/services/definitions/__tests__/agent-runtime-registry.test.ts
```

Expected: both commands pass.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/definitions desktop/electron/services/definitions desktop/scripts/generate-definitions-registry.mjs
git commit -m "feat: add agent runtime registry"
```

Expected: commit succeeds.

---

### Task 5: Route Agent Runtime Adapter Creation Through The Registry

**Files:**
- Modify: `desktop/electron/services/agent-runtime/index.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/agent-runtime-definition-lookup.test.ts`

- [ ] **Step 1: Write the failing lookup test**

Create `desktop/electron/services/agent-runtime/__tests__/agent-runtime-definition-lookup.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { createAdapterFromRuntimeDefinition } from "../index"

describe("Agent runtime definition lookup", () => {
  it("creates the requested adapter from runtime view", () => {
    const runner = {
      run: vi.fn(),
      start: vi.fn(),
    }

    expect(createAdapterFromRuntimeDefinition({
      projectId: "project-1",
      agentType: "claude-code",
      providers: [],
      env: {},
      envAllowlist: [],
    }, runner).agentType).toBe("claude-code")
  })

  it("throws a readable error for unknown agent runtimes", () => {
    const runner = {
      run: vi.fn(),
      start: vi.fn(),
    }

    expect(() => createAdapterFromRuntimeDefinition({
      projectId: "project-1",
      agentType: "missing-agent",
      providers: [],
      env: {},
      envAllowlist: [],
    }, runner)).toThrow("Unknown agent runtime: missing-agent")
  })
})
```

- [ ] **Step 2: Verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/agent-runtime/__tests__/agent-runtime-definition-lookup.test.ts
```

Expected: FAIL because `createAdapterFromRuntimeDefinition` does not exist.

- [ ] **Step 3: Replace hardcoded adapter imports and factory**

In `desktop/electron/services/agent-runtime/index.ts`, remove direct imports of `CodexExecAdapter` and `ClaudeCodeAdapter` for the service factory path. Keep the existing re-exports at the bottom of the file.

Add:

```ts
import {
  agentRuntimeDefinitionById,
} from "../definitions/generated/main-registry"
import type { AgentRuntimeProcessRunner } from "../../../src/definitions/main-types"
```

Export the lookup helper:

```ts
export function createAdapterFromRuntimeDefinition(
  view: ProviderRuntimeView,
  runner: AgentRuntimeProcessRunner,
): AgentAdapter {
  const definition = agentRuntimeDefinitionById.get(view.agentType)
  if (!definition) {
    throw new Error(`Unknown agent runtime: ${view.agentType}`)
  }
  return definition.createAdapter(view, runner)
}
```

In `createAgentRuntimeProjectService()`, replace:

```ts
adapter: new CodexExecAdapter(runner),
agentType: "codex",
adapterFactory: (view) => adapterFromRuntimeView(view, runner),
```

with:

```ts
adapter: createAdapterFromRuntimeDefinition({
  projectId: ctx.projectId,
  agentType: "codex",
  providers: [],
  env: {},
  envAllowlist: [],
}, runner),
agentType: "codex",
adapterFactory: (view) => createAdapterFromRuntimeDefinition(view, runner),
```

Delete the old private `adapterFromRuntimeView()` function.

- [ ] **Step 4: Verify runtime lookup tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/agent-runtime/__tests__/agent-runtime-definition-lookup.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run existing Agent runtime adapter tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/agent-runtime/__tests__/codex-exec.test.ts desktop/electron/services/agent-runtime/__tests__/claude-code.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/agent-runtime/index.ts desktop/electron/services/agent-runtime/__tests__/agent-runtime-definition-lookup.test.ts
git commit -m "refactor: create agent adapters from registry"
```

Expected: commit succeeds.

---

### Task 6: Move Agent Modes To Definitions

**Files:**
- Modify: `desktop/electron/services/agent-runtime/command-router.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/command-router.test.ts`

- [ ] **Step 1: Add test coverage for definition-driven modes**

In `desktop/electron/services/agent-runtime/__tests__/command-router.test.ts`, add:

```ts
import { modesForAgent } from "../command-router"
```

Add tests:

```ts
describe("modesForAgent", () => {
  it("reads Codex modes from Agent definitions", () => {
    expect(modesForAgent("codex").map((mode) => mode.key)).toEqual([
      "suggest",
      "auto-edit",
      "full-auto",
      "yolo",
    ])
  })

  it("reads Claude Code modes from Agent definitions", () => {
    expect(modesForAgent("claude_code").map((mode) => mode.key)).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "auto",
      "bypassPermissions",
      "dontAsk",
    ])
  })

  it("throws a readable error for unknown Agent modes", () => {
    expect(() => modesForAgent("unknown-agent")).toThrow("Unknown agent runtime: unknown-agent")
  })
})
```

- [ ] **Step 2: Verify the new unknown-agent assertion fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/agent-runtime/__tests__/command-router.test.ts
```

Expected: FAIL because unknown agents currently fall back to Codex modes.

- [ ] **Step 3: Update `modesForAgent()` to read the registry**

In `desktop/electron/services/agent-runtime/command-router.ts`, import:

```ts
import { agentRuntimeDefinitionById } from "../definitions/generated/main-registry"
```

Replace the current hardcoded `modesForAgent()` body with:

```ts
export function modesForAgent(agentType: string): readonly ModeOption[] {
  const normalized = normalizeAgentType(agentType)
  const definition = agentRuntimeDefinitionById.get(normalized)
  if (!definition) {
    throw new Error(`Unknown agent runtime: ${agentType}`)
  }
  return definition.modes
}
```

Remove the inline hardcoded Codex and Claude Code mode arrays from `command-router.ts`.

- [ ] **Step 4: Verify command-router tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/agent-runtime/__tests__/command-router.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/agent-runtime/command-router.ts desktop/electron/services/agent-runtime/__tests__/command-router.test.ts
git commit -m "refactor: read agent modes from definitions"
```

Expected: commit succeeds.

---

### Task 7: Move Provider Env Mapping To Agent Runtime Definitions

**Files:**
- Modify: `desktop/electron/services/provider-config/provider-config-service.ts`
- Test: `desktop/electron/services/provider-config/__tests__/provider-config-service.test.ts`

- [ ] **Step 1: Add a regression test for unknown runtime env mapping**

In `desktop/electron/services/provider-config/__tests__/provider-config-service.test.ts`, add a test near the existing runtime config tests:

```ts
it("fails clearly when resolving runtime config for an unknown Agent", async () => {
  const providers = new MemoryNamespace<ProviderEntryV1>("providers")
  const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
  const service = new ProviderConfigService({ providers, secrets, now: fixedNow })

  await expect(service.resolveRuntimeConfig("project-1", "unknown-agent"))
    .rejects
    .toThrow("Unknown agent runtime: unknown-agent")
})
```

- [ ] **Step 2: Verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/provider-config/__tests__/provider-config-service.test.ts
```

Expected: FAIL because unknown agents currently use the OpenAI-compatible fallback.

- [ ] **Step 3: Import the runtime registry**

In `desktop/electron/services/provider-config/provider-config-service.ts`, add:

```ts
import { agentRuntimeDefinitionById } from "../definitions/generated/main-registry"
```

- [ ] **Step 4: Replace `buildRuntimeEnv()` usage**

In `resolveRuntimeConfig()`, replace:

```ts
const env = buildRuntimeEnv(agentType, provider, apiKey, model)
```

with:

```ts
const definition = agentRuntimeDefinitionById.get(normalizeAgentType(agentType))
if (!definition) {
  throw new Error(`Unknown agent runtime: ${agentType}`)
}
const envResult = definition.buildEnv({ provider, apiKey, model })
const env = envResult.env
```

Replace:

```ts
envAllowlist: Object.keys(env).filter((key) => env[key] !== undefined),
```

with:

```ts
envAllowlist: [
  ...Object.keys(env).filter((key) => env[key] !== undefined),
  ...(envResult.extraEnvAllowlist ?? []),
],
```

Delete the old private `buildRuntimeEnv()` function after tests pass.

- [ ] **Step 5: Verify provider config tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/provider-config/__tests__/provider-config-service.test.ts desktop/electron/services/provider-config/__tests__/codex-runtime.test.ts
```

Expected: PASS. Existing Codex and Claude Code env expectations remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/provider-config/provider-config-service.ts desktop/electron/services/provider-config/__tests__/provider-config-service.test.ts
git commit -m "refactor: build provider env from agent definitions"
```

Expected: commit succeeds.

---

### Task 8: Resolve Provider State For The Active Agent

**Files:**
- Modify: `desktop/electron/modules/agent/ipc.ts`
- Test: `desktop/electron/modules/agent/__tests__/ipc.test.ts`

- [ ] **Step 1: Update the provider IPC test**

In `desktop/electron/modules/agent/__tests__/ipc.test.ts`, update `"returns provider summaries without secrets"` so the mock provider config includes:

```ts
getActiveAgentType: vi.fn().mockResolvedValue("claude-code"),
getProjectProviderState: vi.fn().mockResolvedValue({
  projectId: "project-1",
  agentType: "claude-code",
  activeProviderId: "anthropic",
  activeModel: "claude-sonnet-4.5",
  activeMode: "plan",
  providers: [{
    id: "anthropic",
    display: "Anthropic",
    model: "claude-sonnet-4.5",
    baseUrl: "https://api.anthropic.example.test",
    secretRef: "secret:anthropic",
    scope: "global",
  }],
}),
```

Expected result:

```ts
expect(result).toEqual({
  projectId: "project-1",
  agentType: "claude-code",
  activeProviderId: "anthropic",
  activeModel: "claude-sonnet-4.5",
  activeMode: "plan",
  providers: [{
    id: "anthropic",
    display: "Anthropic",
    active: true,
    model: "claude-sonnet-4.5",
    baseUrl: "https://api.anthropic.example.test",
    scope: "global",
  }],
})
```

- [ ] **Step 2: Verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/modules/agent/__tests__/ipc.test.ts
```

Expected: FAIL because the handler still requests Codex provider state.

- [ ] **Step 3: Use active agent type in `getProviders`**

In `desktop/electron/modules/agent/ipc.ts`, replace:

```ts
const state = await providerConfig.getProjectProviderState(request.projectId, "codex")
```

with:

```ts
const agentType = await providerConfig.getActiveAgentType(request.projectId, "codex")
const state = await providerConfig.getProjectProviderState(request.projectId, agentType)
```

- [ ] **Step 4: Verify Agent IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/modules/agent/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/modules/agent/ipc.ts desktop/electron/modules/agent/__tests__/ipc.test.ts
git commit -m "fix: resolve providers for active agent"
```

Expected: commit succeeds.

---

### Task 9: Add Agent Runtime Status API

**Files:**
- Modify: `desktop/src/types/agent.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/modules/agent/ipc.ts`
- Modify: `desktop/electron/preload.ts`
- Generated: `desktop/electron/generated/ipc-channels.generated.ts`
- Test: `desktop/electron/modules/agent/__tests__/ipc.test.ts`

- [ ] **Step 1: Add status IPC test**

In `desktop/electron/modules/agent/__tests__/ipc.test.ts`, add:

```ts
it("returns Agent runtime readiness without exposing secrets", async () => {
  const harness = createHarness({
    providerConfig: {
      getProjectProviderState: vi.fn().mockImplementation(async (_projectId: string, agentType: string) => ({
        projectId: "project-1",
        agentType,
        activeProviderId: agentType === "codex" ? "openai" : undefined,
        activeModel: agentType === "codex" ? "gpt-5.4" : undefined,
        providers: agentType === "codex"
          ? [{
              id: "openai",
              display: "OpenAI",
              model: "gpt-5.4",
              baseUrl: "https://api.example.test",
              secretRef: "secret:openai",
              scope: "global",
            }]
          : [],
      })),
    },
  })

  const result = await harness.invoke("synapse:agent:get-runtime-status", {
    projectId: "project-1",
  }) as {
    readonly agents: readonly {
      readonly id: string
      readonly ready: boolean
      readonly issues: readonly string[]
      readonly provider?: { readonly activeProviderId?: string; readonly activeModel?: string }
    }[]
  }

  expect(result.agents.map((agent) => agent.id)).toEqual(["claude-code", "codex"])
  expect(result.agents.find((agent) => agent.id === "codex")).toEqual(expect.objectContaining({
    ready: expect.any(Boolean),
    provider: {
      activeProviderId: "openai",
      activeModel: "gpt-5.4",
    },
  }))
  expect(result.agents.find((agent) => agent.id === "claude-code")?.issues).toContain("provider-not-configured")
})
```

- [ ] **Step 2: Verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/modules/agent/__tests__/ipc.test.ts
```

Expected: FAIL because the IPC method does not exist.

- [ ] **Step 3: Add renderer types**

Append to `desktop/src/types/agent.ts`:

```ts
export interface SynapseAgentRuntimeCliStatus {
  readonly required: boolean
  readonly binary?: string
  readonly installed: boolean
  readonly path: string | null
}

export interface SynapseAgentRuntimeProviderStatus {
  readonly projectId?: string
  readonly configured: boolean
  readonly activeProviderId?: string
  readonly activeModel?: string
}

export interface SynapseAgentRuntimeStatusItem {
  readonly id: string
  readonly label: string
  readonly ready: boolean
  readonly cli: SynapseAgentRuntimeCliStatus
  readonly provider?: SynapseAgentRuntimeProviderStatus
  readonly issues: string[]
}

export interface SynapseAgentRuntimeStatus {
  readonly projectId?: string
  readonly agents: SynapseAgentRuntimeStatusItem[]
}
```

Import `SynapseAgentRuntimeStatus` in `desktop/src/types/bridge.ts` and add:

```ts
getRuntimeStatus: (
  request: { projectId?: string },
) => Promise<SynapseAgentRuntimeStatus>
```

inside the existing `agent` bridge section.

- [ ] **Step 4: Add IPC schemas and handler**

In `desktop/electron/modules/agent/ipc.ts`, import:

```ts
import { agentRuntimeDefinitions } from "../../services/definitions/generated/main-registry"
import { whichBin } from "../../services/cli/cli-detect-service"
```

Add schemas:

```ts
const runtimeStatusRequestSchema = z.object({
  projectId: z.string().optional(),
})

const runtimeStatusSchema = z.object({
  projectId: z.string().optional(),
  agents: z.array(z.object({
    id: z.string(),
    label: z.string(),
    ready: z.boolean(),
    cli: z.object({
      required: z.boolean(),
      binary: z.string().optional(),
      installed: z.boolean(),
      path: z.string().nullable(),
    }),
    provider: z.object({
      projectId: z.string().optional(),
      configured: z.boolean(),
      activeProviderId: z.string().optional(),
      activeModel: z.string().optional(),
    }).optional(),
    issues: z.array(z.string()),
  })),
})
```

Add method under `agentIpcModule.methods`:

```ts
getRuntimeStatus: {
  kind: "invoke",
  channel: "synapse:agent:get-runtime-status",
  request: runtimeStatusRequestSchema,
  response: runtimeStatusSchema,
  handler: async (ctx, request: { projectId?: string }) => {
    const providerConfig = request.projectId
      ? (await resolveProjectAgent(ctx.resolve, request.projectId)).providerConfig
      : undefined
    const agents = await Promise.all(agentRuntimeDefinitions.map(async (definition) => {
      const binary = definition.runtime.binaries[0]
      const path = binary ? await whichBin(binary) : null
      const provider = request.projectId && providerConfig
        ? await providerConfig.getProjectProviderState(request.projectId, definition.id)
        : undefined
      const issues: string[] = []
      if (binary && !path) issues.push("cli-not-installed")
      if (request.projectId && (!provider || provider.providers.length === 0 || !provider.activeProviderId)) {
        issues.push("provider-not-configured")
      }
      if (request.projectId && provider?.activeProviderId && !provider.activeModel) {
        issues.push("model-not-selected")
      }
      return {
        id: definition.id,
        label: definition.label,
        ready: issues.length === 0,
        cli: {
          required: definition.runtime.kind === "local-cli",
          binary,
          installed: path !== null,
          path,
        },
        provider: request.projectId ? {
          projectId: request.projectId,
          configured: Boolean(provider?.activeProviderId),
          activeProviderId: provider?.activeProviderId,
          activeModel: provider?.activeModel,
        } : undefined,
        issues,
      }
    }))
    return {
      projectId: request.projectId,
      agents,
    }
  },
},
```

- [ ] **Step 5: Update preload and generated IPC channels**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

In `desktop/electron/preload.ts`, add:

```ts
getRuntimeStatus: invoke(IPC_CHANNELS.agent.getRuntimeStatus),
```

inside the existing `agent` bridge object.

- [ ] **Step 6: Verify Agent IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/modules/agent/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/types/agent.ts desktop/src/types/bridge.ts desktop/electron/modules/agent/ipc.ts desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/electron/modules/agent/__tests__/ipc.test.ts
git commit -m "feat: expose agent runtime status"
```

Expected: commit succeeds.

---

### Task 10: Replace Settings CLI Tool Panel With Agent Runtime Status

**Files:**
- Create: `desktop/src/modules/settings/components/agent-runtime-panel.tsx`
- Create: `desktop/src/modules/settings/components/__tests__/agent-runtime-panel.test.tsx`
- Modify: `desktop/src/modules/settings/components/tools-panel.tsx`
- Modify: `desktop/src/modules/settings/data.ts`

- [ ] **Step 1: Write the component rendering test**

Create `desktop/src/modules/settings/components/__tests__/agent-runtime-panel.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { AgentRuntimePanel } from "../agent-runtime-panel"

vi.mock("@/modules/settings/hooks/use-agent-runtime-status", () => ({
  useAgentRuntimeStatus: () => ({
    loading: false,
    refresh: vi.fn(),
    status: {
      projectId: "project-1",
      agents: [{
        id: "codex",
        label: "Codex",
        ready: true,
        cli: {
          required: true,
          binary: "codex",
          installed: true,
          path: "/opt/homebrew/bin/codex",
        },
        provider: {
          projectId: "project-1",
          configured: true,
          activeProviderId: "openai",
          activeModel: "gpt-5.4",
        },
        issues: [],
      }, {
        id: "claude-code",
        label: "Claude Code",
        ready: false,
        cli: {
          required: true,
          binary: "claude",
          installed: false,
          path: null,
        },
        provider: {
          projectId: "project-1",
          configured: false,
        },
        issues: ["cli-not-installed", "provider-not-configured"],
      }],
    },
  }),
}))

describe("AgentRuntimePanel", () => {
  it("renders Agent readiness instead of raw CLI wording", () => {
    const html = renderToStaticMarkup(<AgentRuntimePanel projectId="project-1" />)

    expect(html).toContain("Agent")
    expect(html).toContain("Codex")
    expect(html).toContain("可用")
    expect(html).toContain("Claude Code")
    expect(html).toContain("未就绪")
    expect(html).toContain("未检测到 claude")
    expect(html).not.toContain("命令行工具")
  })
})
```

- [ ] **Step 2: Create the hook file used by the test**

Create `desktop/src/modules/settings/hooks/use-agent-runtime-status.ts`:

```ts
import { useCallback, useEffect, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseAgentRuntimeStatus } from "@/types/agent"

const logger = createRendererLogger("settings.agent-runtime")

function useAgentRuntimeStatus(projectId: string | undefined) {
  const [status, setStatus] = useState<SynapseAgentRuntimeStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    setLoading(true)
    requireSynapseBridge()
      .agent.getRuntimeStatus({ projectId })
      .then(setStatus)
      .catch((error) => {
        logger.error("Failed to load Agent runtime status.", error)
        setStatus(null)
      })
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { status, loading, refresh }
}

export { useAgentRuntimeStatus }
```

- [ ] **Step 3: Verify component test fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/settings/components/__tests__/agent-runtime-panel.test.tsx
```

Expected: FAIL because `AgentRuntimePanel` does not exist.

- [ ] **Step 4: Create `AgentRuntimePanel`**

Create `desktop/src/modules/settings/components/agent-runtime-panel.tsx`:

```tsx
import { RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type { SynapseAgentRuntimeStatusItem } from "@/types/agent"
import { useAgentRuntimeStatus } from "../hooks/use-agent-runtime-status"

function AgentRuntimePanel({ projectId }: { readonly projectId?: string }) {
  const { status, loading, refresh } = useAgentRuntimeStatus(projectId)
  const agents = status?.agents ?? []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Agent</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            disabled={loading}
            onClick={refresh}
          >
            <RefreshCw className={loading ? "size-3 animate-spin" : "size-3"} />
            重新检测
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {agents.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">暂无 Agent</p>
        ) : agents.map((agent, index) => (
          <div key={agent.id}>
            {index > 0 ? <Separator /> : null}
            <AgentRuntimeRow item={agent} />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function AgentRuntimeRow({ item }: { readonly item: SynapseAgentRuntimeStatusItem }) {
  const issueText = formatIssueText(item)

  return (
    <div className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-center gap-2 font-medium">
        <span>{item.label}</span>
        <Badge variant={item.ready ? "secondary" : "outline"}>
          {item.ready ? "可用" : "未就绪"}
        </Badge>
      </div>
      {issueText ? (
        <p className="text-sm text-muted-foreground">{issueText}</p>
      ) : item.provider?.activeModel ? (
        <p className="truncate text-sm text-muted-foreground">{item.provider.activeModel}</p>
      ) : item.cli.path ? (
        <p className="truncate text-sm text-muted-foreground" title={item.cli.path}>{item.cli.path}</p>
      ) : null}
    </div>
  )
}

function formatIssueText(item: SynapseAgentRuntimeStatusItem): string | null {
  const binary = item.cli.binary ?? item.id
  if (item.issues.includes("cli-not-installed")) return `未检测到 ${binary}`
  if (item.issues.includes("provider-not-configured")) return "未配置 provider"
  if (item.issues.includes("model-not-selected")) return "未选择模型"
  return null
}

export { AgentRuntimePanel, AgentRuntimeRow, formatIssueText }
```

- [ ] **Step 5: Wire `ToolsPanel` to Agent runtime status**

In `desktop/src/modules/settings/components/tools-panel.tsx`:

Remove imports:

```ts
import { Fragment } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useCliDetect } from "@/modules/cli/hooks/use-cli-detect"
import { CliToolRow } from "@/modules/cli/components/cli-tool-card"
```

Add:

```ts
import { AgentRuntimePanel } from "@/modules/settings/components/agent-runtime-panel"
```

Change component signature:

```ts
function ToolsPanel({ projectId }: { readonly projectId?: string }) {
```

Remove `const { results, loading, refresh } = useCliDetect()`.

Replace the second `Card` block with:

```tsx
<AgentRuntimePanel projectId={projectId} />
```

In `desktop/src/modules/settings/index.tsx`, pass the active project id:

```tsx
import { resolveAgentProjectScope } from "@/modules/agent/project-resolution"
```

Inside `SettingsModule()`, add:

```tsx
const agentProjectScope = useMemo(() =>
  resolveAgentProjectScope(activeRepository, config.global.projects),
[activeRepository, config.global.projects])
```

Then render:

```tsx
{isReady && activeCategory === "tools" ? (
  <ToolsPanel projectId={agentProjectScope.defaultProjectId} />
) : null}
```

- [ ] **Step 6: Update settings category copy**

In `desktop/src/modules/settings/data.ts`, change the tools category description:

```ts
description: "编辑器与 Agent。",
```

- [ ] **Step 7: Verify settings component test**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/settings/components/__tests__/agent-runtime-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/modules/settings/components/agent-runtime-panel.tsx desktop/src/modules/settings/components/__tests__/agent-runtime-panel.test.tsx desktop/src/modules/settings/hooks/use-agent-runtime-status.ts desktop/src/modules/settings/components/tools-panel.tsx desktop/src/modules/settings/index.tsx desktop/src/modules/settings/data.ts
git commit -m "feat: show agent runtime status in settings"
```

Expected: commit succeeds.

---

### Task 11: Remove Old Agent CLI Detection UI

**Files:**
- Delete: `desktop/src/modules/cli/components/cli-detect-panel.tsx`
- Delete: `desktop/src/modules/cli/components/cli-tool-card.tsx`
- Delete: `desktop/src/modules/cli/hooks/use-cli-detect.ts`
- Delete: `desktop/src/modules/cli/lib/cli-icons.ts`
- Delete: `desktop/src/types/cli.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/preload.ts`
- Move: `desktop/electron/services/cli/cli-detect-service.ts` -> `desktop/electron/services/agent-runtime/binary-detect-service.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Delete: `desktop/electron/modules/cli/ipc.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`
- Modify: `desktop/scripts/generate-definitions-registry.mjs`
- Modify: `desktop/src/definitions/types.ts`
- Generated: `desktop/src/definitions/generated/renderer-registry.ts`
- Generated: `desktop/electron/services/definitions/generated/main-registry.ts`

- [ ] **Step 1: Verify no renderer uses `modules/cli`**

Run:

```bash
rg -n 'modules/cli|useCliDetect|CliToolRow|SynapseCliDetectResult' desktop/src desktop/electron
```

Expected: matches only in files listed for deletion or bridge/preload types.

- [ ] **Step 2: Remove CLI IPC from bridge types and preload**

In `desktop/src/types/bridge.ts`, remove:

```ts
import type { SynapseCliDetectResult } from "./cli"
```

and remove the `cli` bridge section:

```ts
cli: {
  detect: () => Promise<SynapseCliDetectResult[]>
}
```

In `desktop/electron/preload.ts`, remove:

```ts
cli: {
  detect: invoke(IPC_CHANNELS.cli.detect),
},
```

- [ ] **Step 3: Remove CLI IPC module registration**

In `desktop/electron/bootstrap/ipc-registry.ts`, remove:

```ts
import { cliIpcModule } from "../modules/cli/ipc"
```

Remove `registry.register(cliIpcModule, ctx)` and remove `cliIpcModule` from `registeredIpcModules`.

- [ ] **Step 4: Delete old CLI UI and IPC files**

```bash
git rm desktop/src/modules/cli/components/cli-detect-panel.tsx
git rm desktop/src/modules/cli/components/cli-tool-card.tsx
git rm desktop/src/modules/cli/hooks/use-cli-detect.ts
git rm desktop/src/modules/cli/lib/cli-icons.ts
git rm desktop/src/types/cli.ts
git rm desktop/electron/modules/cli/ipc.ts
```

- [ ] **Step 5: Move binary detection under Agent runtime**

```bash
git mv desktop/electron/services/cli/cli-detect-service.ts desktop/electron/services/agent-runtime/binary-detect-service.ts
```

In `desktop/electron/services/agent-runtime/binary-detect-service.ts`, remove:

```ts
import type { SynapseCliDetectResult, SynapseCliId } from "../../../src/types/cli"
import { cliDefinitions } from "../definitions/generated/main-registry"
```

Delete:

```ts
const CLI_DEFINITIONS: ReadonlyArray<{ id: SynapseCliId; label: string; bin: string }> = cliDefinitions
  .map((definition) => ({
    id: definition.id as SynapseCliId,
    label: definition.label,
    bin: definition.binaries[0],
  }))
```

Delete the `detectClis()` function.

Export only:

```ts
export { whichBin }
```

In `desktop/electron/modules/agent/ipc.ts`, replace:

```ts
import { whichBin } from "../../services/cli/cli-detect-service"
```

with:

```ts
import { whichBin } from "../../services/agent-runtime/binary-detect-service"
```

- [ ] **Step 6: Remove `cliDefinitions` from definitions generator and types**

In `desktop/scripts/generate-definitions-registry.mjs`, remove:

```js
cliImports
cliDefinitions
importableCliDirs
```

Remove generated `cliDefinitions` from both renderer and main registry outputs.

In `desktop/src/definitions/types.ts`, remove:

```ts
export type SynapseCliDefinition = {
  id: string
  label: string
  order: number
  binaries: string[]
}
```

Delete old editor CLI definition files:

```bash
git rm desktop/src/definitions/editor/codex/cli.ts
git rm desktop/src/definitions/editor/claude-code/cli.ts
```

- [ ] **Step 7: Regenerate IPC and definitions**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
pnpm --filter @synapse/desktop run generate:definitions-registry
```

Expected: generated IPC has no `cli` section; generated definition registries have no `cliDefinitions`.

- [ ] **Step 8: Verify no old CLI references remain**

Run:

```bash
rg -n 'cliDefinitions|SynapseCli|modules/cli|synapse:cli:detect|IPC_CHANNELS\\.cli|cliIpcModule|services/cli' desktop/src desktop/electron desktop/scripts
```

Expected: no matches.

- [ ] **Step 9: Commit**

```bash
git add desktop/src desktop/electron desktop/scripts
git commit -m "refactor: remove standalone agent cli detection ui"
```

Expected: commit succeeds.

---

### Task 12: Final Verification

**Files:**
- No source edits expected unless verification exposes a defect.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/definitions/__tests__/editor-registry.test.ts desktop/src/definitions/__tests__/agent-registry.test.ts desktop/electron/services/definitions/__tests__/agent-runtime-registry.test.ts desktop/electron/services/agent-runtime/__tests__/agent-runtime-definition-lookup.test.ts desktop/electron/services/agent-runtime/__tests__/command-router.test.ts desktop/electron/services/provider-config/__tests__/provider-config-service.test.ts desktop/electron/modules/agent/__tests__/ipc.test.ts desktop/src/modules/settings/components/__tests__/agent-runtime-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run generated-code checks**

Run:

```bash
pnpm --filter @synapse/desktop run generate:definitions-registry
pnpm --filter @synapse/desktop run generate:ipc
git diff -- desktop/src/definitions/generated/renderer-registry.ts desktop/electron/services/definitions/generated/main-registry.ts desktop/electron/generated/ipc-channels.generated.ts
```

Expected: no diff after generation.

- [ ] **Step 3: Run project checks**

Run:

```bash
pnpm desktop:typecheck
pnpm desktop:test
pnpm desktop:check:hard-constraints
```

Expected: all commands pass.

- [ ] **Step 4: Confirm old paths are gone**

Run:

```bash
test ! -d desktop/src/ide-definitions
test ! -d desktop/electron/services/ide-definitions
rg -n 'ide-definitions|generate-ide-registry|cliDefinitions' desktop package.json
```

Expected: the two `test ! -d` commands exit successfully; `rg` prints no matches.

- [ ] **Step 5: Commit verification fixes when verification exposes a defect**

If Step 1 through Step 4 pass without edits, do not create an empty commit.

If a verification defect required a code edit, commit only that fix:

```bash
git add <changed-files>
git commit -m "fix: complete editor agent definition split"
```

Expected: repository has the implementation commits and no accidental changes to unrelated Agent UI files.
