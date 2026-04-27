# Editor and Agent Definition Split

## Summary

Synapse will split the current editor/product metadata and Agent runtime metadata into two first-class definition systems:

- `desktop/src/definitions/editor/`
- `desktop/src/definitions/agent/`

The existing `desktop/src/ide-definitions/` concept is too broad and too narrow at the same time. It currently stores editor/product definitions, CLI metadata, MCP metadata, install behavior, and scan behavior. Meanwhile, Agent runtime behavior for Codex and Claude Code lives separately in Electron services with hardcoded branches.

The new structure makes the product model explicit:

- An `editor` is a target that can receive rules, skills, and MCP configuration.
- An `agent` is a local runtime that Synapse can start and talk to from the Agent page.

Codex and Claude Code can appear in both systems because they have both identities. Cursor and Windsurf remain editor-only until they have a real Agent runtime.

## Current State

The current editor and CLI definitions live under:

```text
desktop/src/ide-definitions/
  cursor/
  windsurf/
  codex/
  claude-code/
  generated/
```

The generator `desktop/scripts/generate-ide-registry.mjs` scans directories with `ide.ts`, and optionally imports `cli.ts`, `mcp.ts`, and `forms.tsx`. The generated CLI definitions are consumed by `desktop/electron/services/cli/cli-detect-service.ts` to power the settings page's command-line tool status display.

Agent runtime behavior is separate:

- `desktop/electron/services/agent-runtime/index.ts` constructs Codex by default and chooses Codex or Claude Code adapters with hardcoded logic.
- `desktop/electron/services/agent-runtime/command-router.ts` hardcodes `/mode` options by agent type.
- `desktop/electron/services/provider-config/provider-config-service.ts` hardcodes runtime environment variables for Codex and Claude Code.
- `desktop/electron/modules/agent/ipc.ts` currently resolves provider state with a fixed Codex agent type.

This means `cli.ts` is not the center of Agent capability. It is only local command detection metadata. The product-facing concept should be Agent runtime availability, not raw CLI installation.

## Goals

1. Replace the ambiguous `ide-definitions` concept with explicit `editor` and `agent` definitions.
2. Keep editor install/scan/MCP behavior separate from Agent runtime behavior.
3. Move Codex and Claude Code Agent runtime branching into generated registries.
4. Make settings show Agent runtime readiness instead of standalone CLI tool status.
5. Preserve renderer/main boundaries: renderer imports metadata only; Electron imports runtime factories.
6. Keep Cursor and Windsurf as editor-only definitions unless a real Agent runtime is added.

## Non-Goals

- Do not treat Cursor or Windsurf as Agent runtimes.
- Do not put Agent adapter logic inside editor definitions.
- Do not introduce a third `product` abstraction.
- Do not expand the old `cli.ts` concept into a top-level product model.
- Do not change the shadcn preset or redesign the settings UI beyond the required semantic change.

## Directory Structure

Final target structure:

```text
desktop/src/definitions/
  editor/
    cursor/
      editor.ts
      adapter.ts
      install.ts
      scan.ts
      mcp.ts
      forms.tsx
      icon.png
    windsurf/
    codex/
    claude-code/
  agent/
    codex/
      agent.ts
      agent-main.ts
    claude-code/
      agent.ts
      agent-main.ts
  generated/
    renderer-registry.ts
```

Main-process generated registry:

```text
desktop/electron/services/definitions/generated/main-registry.ts
```

The existing `ide.ts` files become `editor.ts`. The old `cli.ts` files are not a long-term source of truth. Their command detection data moves into the relevant Agent runtime definition when the command is an Agent dependency.

## Editor Definitions

Editor definitions describe where Synapse content can be installed and scanned. They cover:

- label, icon, order
- supported content types
- global and project support
- MCP settings location and format
- install strategy
- scan strategy
- optional install forms

Current editor entries:

- Cursor
- Windsurf
- Codex
- Claude Code

Editor definitions do not create Agent adapters, build provider environments, or define Agent modes.

## Agent Definitions

Agent definitions describe runtimes that Synapse can execute for conversations. They cover:

- agent id, label, order
- optional `relatedEditorId` for icon/name reuse
- local runtime dependencies
- mode options
- provider environment mapping
- adapter creation on the Electron side
- capability metadata for UI and future status reporting

Current Agent entries:

- Codex
- Claude Code

Recommended shape:

```ts
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
}
```

`agent.ts` must stay renderer-safe. It contains serializable metadata only.

`agent-main.ts` can import Electron/main-process services and adapter implementations. It owns the runtime-specific functions that are unsafe for the renderer.

## Generated Registries

The current generator should be renamed from `generate-ide-registry.mjs` to `generate-definitions-registry.mjs`.

Renderer registry exports:

```ts
export const editorDefinitions = [...]
export const agentDefinitions = [...]
export const mcpDefinitions = [...]
export const installFormDefinitionByEditorId = new Map(...)
```

Main registry exports:

```ts
export const editorAdapters = [...]
export const editorAdapterById = new Map(...)
export const editorInstallStrategyById = new Map(...)
export const editorScanStrategyById = new Map(...)
export const agentRuntimeDefinitions = [...]
export const agentRuntimeDefinitionById = new Map(...)
export const mcpDefinitions = [...]
```

The renderer registry must not import `agent-main.ts`, editor adapters, install strategies, scan strategies, or Node/Electron code.

## Runtime Data Flow

Agent execution should resolve runtime behavior through the Agent definition registry:

```text
AgentRuntimeService
  -> ProviderConfigService.resolveRuntimeConfig(projectId, agentId)
  -> agentRuntimeDefinitionById.get(agentId)
  -> definition.createAdapter(runtimeView, runner)
  -> adapter.send(...)
```

The current `adapterFromRuntimeView()` branch should become a registry lookup. Unknown agent ids should fail with a clear error.

Mode resolution should also use the Agent definition:

```text
/mode command
  -> active agent id
  -> agentRuntimeDefinitionById.get(agentId).modes
```

Provider environment mapping should move from `ProviderConfigService` into Agent runtime definitions:

```text
ProviderConfigService.resolveRuntimeConfig(...)
  -> selected provider and model
  -> agentRuntimeDefinition.buildEnv(...)
```

Codex must preserve the current OpenAI-compatible variables and Codex-specific `CODEX_HOME` handling. Claude Code must preserve the current Anthropic-compatible variables.

## Settings Semantics

The settings page should stop presenting raw CLI status as a product concept. It should show Agent runtime readiness.

Current wording:

```text
命令行工具
Codex CLI 已安装 / 未安装
Claude Code CLI 已安装 / 未安装
```

Target wording:

```text
Agent
Codex 可用 / 未就绪
Claude Code 可用 / 未就绪
```

Readiness includes:

- local CLI detected
- provider available
- model selected when required
- runtime-specific configuration available

CLI detection remains useful internally, but it becomes one requirement inside Agent status. The old `modules/cli` UI stays only as a migration compatibility layer until all settings consumers move to Agent status, then it should be removed.

## Migration Plan

### Phase 1: Directory and Registry Skeleton

1. Create `desktop/src/definitions/editor/` and migrate the existing `ide-definitions` directories.
2. Rename `ide.ts` to `editor.ts` and update types from `SynapseIdeDefinition` to `SynapseEditorDefinition`.
3. Create `desktop/src/definitions/agent/` with Codex and Claude Code metadata.
4. Rename and update the registry generator to scan both `editor` and `agent`.
5. Keep temporary compatibility exports if needed to avoid one large import-path change.

### Phase 2: Agent Runtime De-Hardcoding

1. Replace `adapterFromRuntimeView()` with a registry lookup.
2. Replace `modesForAgent()` hardcoded branches with definition-driven mode lookup.
3. Move `buildRuntimeEnv()` behavior into Agent runtime definitions.
4. Update `agent:get-providers` to resolve the active agent type instead of fixed Codex.

### Phase 3: Settings Agent Runtime Status

1. Add a main-process Agent runtime status service.
2. Derive local CLI checks from `agentDefinition.runtime`.
3. Return Agent readiness records to the renderer.
4. Replace the settings "命令行工具" panel with an Agent status panel.
5. Remove or deprecate `cliDefinitions` and `modules/cli` after all consumers move.

### Phase 4: Tests and Cleanup

1. Update registry generator tests or add coverage for editor and agent registry output.
2. Update Agent runtime tests for registry-driven adapter selection.
3. Update provider-config tests for definition-driven env mapping.
4. Update command-router tests for definition-driven mode options.
5. Update settings tests for Agent readiness UI.
6. Run:

```text
pnpm desktop:typecheck
pnpm desktop:test
pnpm desktop:check:hard-constraints
```

## Error Handling

- Missing Agent definition: return a clear error naming the unknown agent id.
- Missing CLI dependency: Agent status is `not-ready` with the missing binary name.
- Missing provider or model: Agent status is `not-ready` with the missing configuration reason.
- Adapter creation failure: log through structured main-process logging and surface a concise user-facing error.
- Renderer must not inspect Electron-specific adapter errors directly.

## Testing Notes

The implementation should be verified mostly through TypeScript and unit tests. Do not start a dev server, browser preview, or Electron runtime unless the user explicitly asks.

Key checks:

- Registry generation includes all four editors and two Agent runtimes.
- Renderer registry does not import main-process files.
- Main registry exposes adapter factories for Codex and Claude Code.
- `/mode` lists match each Agent definition.
- Provider env output stays compatible with current Codex and Claude Code behavior.
- Settings Agent readiness reports missing CLI and configured CLI paths correctly.

## Open Decisions Resolved

- Use final target structure, not a minimal additive structure.
- Use `editor` and `agent` as the two top-level concepts.
- Keep Codex and Claude Code in both systems where appropriate.
- Do not add a third product layer.
- Make Agent readiness the settings-page product concept; CLI is an internal requirement.
