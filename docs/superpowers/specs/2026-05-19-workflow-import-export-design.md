# Workflow Import/Export With Model Mapping Design

## Summary

Add file-based workflow sharing for trusted small teams. A user can export one workflow into a `.synapse-workflow.json` package. Another user can import that file, review the original model usage, map each original provider/model combination to a local provider/model tier, and save the workflow as a new local workflow.

The design keeps sharing simple: one file, no cloud account, no publishing workflow, no permissions model. The important compatibility layer is model mapping, because provider IDs are local to each machine.

## Current State

Workflow definitions are saved by `WorkflowService` through `DataRepository.namespace("workflows")`. The `workflows` namespace uses the JSON backend and persists under Electron `userData/data-v1/workflows.json`.

Workflow definitions contain:

- `defaultProviderId` and `defaultModelTier` at the workflow level.
- `nodes[].config.providerId` and `nodes[].config.modelTier` for nodes that explicitly choose a model.
- `params`, `nodes`, and `edges`, which are already JSON-serializable.

Run history is stored separately under `userData/workflow-runs/<workflowId>/<runId>.json`. It should not be included in workflow sharing.

The current renderer bridge exposes list/get/create/save/delete/validate/run APIs. It does not expose workflow import/export APIs.

## Goals

- Export a single workflow to a portable JSON package.
- Show the importer what provider/model combinations the exporter used.
- Let the importer map each original provider/model combination to any local provider/model tier.
- Allow multiple original combinations to map to the same local target.
- Prefer low-friction import: auto-select reasonable mappings when possible.
- Save imported workflows as new workflows, never overwrite an existing local workflow.
- Preserve workflow structure, including whether a node inherited the workflow default model or had an explicit model.

## Non-Goals

- No cloud sharing, marketplace, permissions, or version update flow.
- No batch export/import.
- No run history export.
- No special sensitive-field redaction in the first version. The intended sharing scope is trusted teammates.
- No direct import into the original workflow ID.

## Export Package

Use a package wrapper rather than exporting raw `WorkflowDefinition`.

```ts
type SynapseWorkflowPackageV1 = {
  format: "synapse-workflow-package-v1"
  exportedAt: string
  workflow: WorkflowDefinition
  modelReferences: WorkflowModelReference[]
}
```

The exported file extension should be:

```text
.synapse-workflow.json
```

Keep the first version intentionally small. Fields such as app version, author, notes, and future compatibility hints can be added later as optional fields.

## Model References

Export should scan the workflow and produce one row per distinct original model combination.

```ts
type ModelTier = "default" | "haiku" | "sonnet" | "opus"

type WorkflowModelReference = {
  id: string
  sourceProviderId?: string
  sourceProviderName?: string
  sourceModelTier: ModelTier
  sourceModelName?: string
  missingOnExporter?: boolean
  occurrences: WorkflowModelOccurrence[]
}

type WorkflowModelOccurrence =
  | { kind: "workflowDefault" }
  | {
      kind: "node"
      nodeId: string
      nodeName: string
      nodeType: string
      inherited: boolean
    }
```

Group references by:

```text
sourceProviderId + sourceModelTier + sourceModelName
```

This is more precise than grouping only by provider. The same provider can use different real models for `default`, `sonnet`, and `opus`, and the importer should be able to map those combinations separately.

## Reference Scanning

The export service should scan:

- Workflow default: `defaultProviderId + defaultModelTier`.
- Each model-capable node with explicit config: `node.config.providerId + node.config.modelTier`.
- Each model-capable node without explicit provider but with a workflow default: inherited workflow default.

For inherited nodes, record `inherited: true` in `occurrences`, but do not treat them as independently configurable during import. They should continue to inherit the imported workflow default.

The service should resolve provider display metadata from the local provider store:

- Provider name.
- Actual model name for the used tier: `model`, `haikuModel`, `sonnetModel`, or `opusModel`.

If the referenced provider no longer exists on the exporter's machine, export should still succeed and set `missingOnExporter: true`.

## Import Mapping

The importer produces this mapping:

```ts
type WorkflowModelMapping = {
  sourceRefId: string
  targetProviderId: string
  targetModelTier: ModelTier
}
```

The importer may map any number of source references to the same target provider/model tier. This supports the common case where the importer only has one local provider but the original workflow used several combinations.

The first version should require every model reference to have a mapping before import is confirmed. This keeps the imported workflow runnable by default.

## Import Rewrite Rules

Import always creates a new workflow:

```ts
const imported = {
  ...package.workflow,
  id: randomUUID(),
  version: "",
  createdAt: now,
  updatedAt: now,
}
```

Then apply mappings by occurrence:

- `workflowDefault`: rewrite `defaultProviderId` and `defaultModelTier`.
- Explicit node occurrence: rewrite that node's `config.providerId` and `config.modelTier`.
- Inherited node occurrence: do not write node config; it should continue inheriting workflow default.

This preserves the original authoring intent. Nodes that inherited defaults remain clean; nodes that intentionally chose a different model remain explicit.

## Import UI

Use a single dialog rather than a multi-step wizard.

Top section:

- Workflow name.
- Node count.
- Model reference count.

Mapping section:

```text
Original model                          Used by             Map to local
DeepSeek / sonnet / deepseek-reasoner   Global, Analysis    [Provider] [Tier]
Claude / opus / claude-opus             Review              [Provider] [Tier]
OpenAI / default / gpt-5-mini           Classification      [Provider] [Tier]
```

Actions:

- `Use default model for all`.
- `Import`.
- `Cancel`.

Low-friction defaults:

- If there is one model reference, default to the user's current default provider/model tier.
- If local provider name or actual model name matches the exported reference, preselect it.
- If no match exists, preselect local default provider/model tier.
- Let the user change every row.

UI copy should stay terse and operational. Avoid explanatory paragraphs in the interface.

## Service Boundary

Add a main-process service, tentatively `WorkflowPackageService`, responsible for:

- Building export packages from workflow IDs.
- Reading and validating import packages.
- Resolving export-time provider metadata.
- Computing import-time suggested mappings.
- Applying confirmed mappings and saving the imported workflow.

Renderer code should not parse or mutate workflow packages directly beyond displaying typed preview data returned by IPC. File IO and dialogs stay in the main process.

## IPC Shape

Add workflow IPC methods:

```ts
workflow.exportPackage(workflowId: string): Promise<{ path: string } | null>
workflow.inspectImportPackage(): Promise<WorkflowImportPreview | null>
workflow.importPackage(input: {
  packagePath: string
  mappings: WorkflowModelMapping[]
}): Promise<{ workflowId: string; versionHash: string } | { errors: ValidationError[] }>
```

`WorkflowImportPreview` should include the selected `packagePath`, workflow summary, model references, local provider options, and suggested mappings. The renderer keeps that `packagePath` and passes it back to `importPackage` after the user confirms mappings.

Exact naming can follow the existing generated IPC conventions.

`inspectImportPackage` should open the file picker, parse the selected package, and return preview data including model references and suggested mappings. `importPackage` should save only after user confirmation.

## Validation

Export validation:

- Workflow must exist.
- Package must include a valid `WorkflowDefinition`.
- Model references should be computed best-effort and should not block export unless the workflow definition is invalid.

Import validation:

- Package `format` must be `synapse-workflow-package-v1`.
- `workflow` must match the existing workflow schema.
- Every mapping must point to an existing local provider.
- Every mapping tier must be valid.
- The rewritten workflow must pass `validateWorkflow` before save.

## Tests

Main-process tests:

- Export package includes workflow definition and model references.
- Model references group by provider ID, model tier, and actual model name.
- Inherited node model usage is recorded but not rewritten as explicit node config.
- Import creates a new workflow ID and does not overwrite the source ID.
- Multiple source references can map to the same target provider/model tier.
- Import rejects missing mappings.
- Import rejects mappings to unknown local providers.

Renderer tests:

- Import dialog renders original provider/model reference rows.
- Auto-selected mappings can be changed.
- `Use default model for all` updates every row.
- Import button is disabled until all references have mappings.

## Open Questions

- Whether export should use a save dialog immediately or return package content for renderer download. Main-process save dialog is more consistent with existing Electron boundaries.
- Whether duplicate imported names should be suffixed automatically, for example `Workflow Name (Imported)`. First version can reuse the original name because IDs are unique.
- Whether script and HTTP nodes should later support optional redaction. This is out of scope for the first trusted-team version.

## Acceptance Criteria

- A user can export a workflow file.
- Another user can import that file on a different machine.
- The importer sees the original provider name, model tier, and model name for each distinct model combination.
- The importer can map three original model combinations to one local model, or map them separately.
- The imported workflow is saved as a new workflow and can be opened in the editor.
- Run history is not imported.
