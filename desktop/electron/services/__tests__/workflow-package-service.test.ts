import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkflowDefinition } from "../../../src/types/workflow"
import type {
  SynapseWorkflowExportPackageV3,
  SynapseWorkflowPackageV1,
  SynapseWorkflowPackageV3,
  WorkflowModelMapping,
} from "../../../src/types/workflow-package"
import type { CCProvider } from "../provider/types"
import "../../../workflow-nodes/register.main"
import { defaultClaudeCodeNodeConfig } from "../../../workflow-nodes/claude-code/schema"
import { defaultCodexNodeConfig } from "../../../workflow-nodes/codex/schema"
import { WorkflowPackageService } from "../workflow/workflow-package-service"
import { readWorkflowShareArchive } from "../workflow/workflow-share-package-v4"
import type { WorkflowExportDocumentResult } from "../workflow/workflow-service"

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => logger,
}))

const nowIso = "2026-05-19T10:00:00.000Z"

function workflowDefinition(): WorkflowDefinition {
  return {
    id: "workflow-source",
    name: "Shared Workflow",
    version: "v_old",
    meta: { schemaVersion: "2.0.0" },
    createdAt: 1,
    updatedAt: 2,
    layoutDirection: "vertical" as const,
    defaultProviderId: "provider-deepseek",
    defaultModelTier: "sonnet",
    defaultProjectId: "exporter-project",
    params: [],
    nodes: [
      {
        id: "n1",
        name: "分析",
        type: "prompt",
        position: { x: 0, y: 0 },
        config: { prompt: "Analyze", variables: [], projectId: "exporter-node-project" },
      },
      {
        id: "n2",
        name: "终审",
        type: "prompt",
        position: { x: 0, y: 200 },
        config: { providerId: "provider-claude", modelTier: "opus", prompt: "Review", variables: [] },
      },
      {
        id: "end",
        name: "结束",
        type: "end",
        position: { x: 0, y: 400 },
        config: { outputType: "text", template: "", variables: [] },
      },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2" },
      { id: "e2", from: "n2", to: "end" },
    ],
  }
}

function codexOnlyPackage(): SynapseWorkflowPackageV1 {
  return {
    format: "synapse-workflow-package-v1",
    exportedAt: nowIso,
    modelReferences: [],
    workflow: {
      id: "codex-source",
      name: "Code X Workflow",
      version: "v_old",
      meta: { schemaVersion: "2.0.0" },
      createdAt: 1,
      updatedAt: 2,
      layoutDirection: "horizontal" as const,
      defaultProjectId: "exporter-project",
      params: [],
      nodes: [
        {
          id: "codex-1",
          name: "Code X",
          type: "codex",
          position: { x: 0, y: 0 },
          config: { ...structuredClone(defaultCodexNodeConfig), prompt: "Run codex" },
        },
        {
          id: "end",
          name: "结束",
          type: "end",
          position: { x: 200, y: 0 },
          config: { outputType: "text", template: "", variables: [] },
        },
      ],
      edges: [{ id: "e1", from: "codex-1", to: "end" }],
    },
  }
}

function claudeCodeOnlyPackage(): SynapseWorkflowPackageV1 {
  return {
    format: "synapse-workflow-package-v1",
    exportedAt: nowIso,
    modelReferences: [],
    workflow: {
      id: "claude-code-source",
      name: "Claude Code Workflow",
      version: "v_old",
      createdAt: 1,
      updatedAt: 2,
      layoutDirection: "horizontal" as const,
      defaultProjectId: "exporter-project",
      params: [],
      nodes: [
        {
          id: "claude-code-1",
          name: "Claude Code",
          type: "claude_code",
          position: { x: 0, y: 0 },
          config: {
            ...structuredClone(defaultClaudeCodeNodeConfig),
            prompt: "Run Claude Code",
            projectId: "exporter-claude-code-project",
          },
        },
        {
          id: "end",
          name: "结束",
          type: "end",
          position: { x: 200, y: 0 },
          config: { outputType: "text", template: "", variables: [] },
        },
      ],
      edges: [{ id: "e1", from: "claude-code-1", to: "end" }],
    },
  }
}

function codexOnlyWorkflowWithDefaultProvider(): WorkflowDefinition {
  return {
    ...codexOnlyPackage().workflow,
    defaultProviderId: "provider-deepseek",
    defaultModelTier: "sonnet",
  }
}

function currentPackage(pkg: SynapseWorkflowExportPackageV3): SynapseWorkflowPackageV3 {
  const workflow = pkg.workflow
  if (!("nodes" in workflow) || !Array.isArray(workflow.nodes)
    || !("edges" in workflow) || !Array.isArray(workflow.edges)
    || !("params" in workflow) || !Array.isArray(workflow.params)) {
    throw new Error("Expected a current workflow export package")
  }
  return { ...pkg, workflow: workflow as WorkflowDefinition }
}

function createService() {
  const saved: WorkflowDefinition[] = []
  const workflowService = {
    getExportDocument: vi.fn(async (id: string): Promise<WorkflowExportDocumentResult | null> => {
      if (id === "workflow-source") return { kind: "current" as const, document: workflowDefinition() }
      if (id === "codex-source") return { kind: "current" as const, document: codexOnlyWorkflowWithDefaultProvider() }
      return null
    }),
    getLegacyMigrationExportDocument: vi.fn(async (): Promise<WorkflowExportDocumentResult | null> => null),
    save: vi.fn(async (def: WorkflowDefinition) => {
      saved.push(def)
      return { versionHash: "v_imported" }
    }),
    commitAtomicBatch: vi.fn(),
  }
  const providerService = {
    listProviders: vi.fn(async (): Promise<CCProvider[]> => [
      {
        id: "provider-deepseek",
        name: "DeepSeek",
        category: "cn_official",
        apiKeyField: "ANTHROPIC_API_KEY",
        active: true,
        model: "deepseek-chat",
        sonnetModel: "deepseek-reasoner",
        env: {},
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "provider-claude",
        name: "Claude",
        category: "official",
        apiKeyField: "ANTHROPIC_API_KEY",
        model: "claude-haiku",
        opusModel: "claude-opus",
        env: {},
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "local-openai",
        name: "OpenAI",
        category: "official",
        apiKeyField: "ANTHROPIC_API_KEY",
        model: "gpt-5-mini",
        sonnetModel: "gpt-5",
        opusModel: "gpt-5-pro",
        env: {},
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]),
  }
  const service = new WorkflowPackageService({
    workflowService,
    providerService,
    permissionGuard: { check: vi.fn(async () => ({ allowed: true as const })) },
    auditSink: { record: vi.fn() },
    now: () => new Date(nowIso),
    createId: () => "workflow-imported",
  })
  return { service, workflowService, providerService, saved }
}

describe("WorkflowPackageService", () => {
  beforeEach(() => {
    logger.info.mockClear()
    logger.warn.mockClear()
  })

  it("builds an export package with grouped model references", async () => {
    const { service } = createService()
    const pkg = currentPackage(await service.buildExportPackage("workflow-source"))

    expect(pkg.format).toBe("synapse-workflow-package")
    expect(pkg.formatVersion).toBe("3.0.0")
    expect(pkg.exportedAt).toBe(nowIso)
    expect(pkg.workflow.id).toBe("workflow-source")
    expect(pkg.modelReferences).toHaveLength(2)
    expect(pkg.modelReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceProviderId: "provider-deepseek",
        sourceProviderName: "DeepSeek",
        sourceModelTier: "sonnet",
        sourceModelName: "deepseek-reasoner",
        occurrences: expect.arrayContaining([
          { kind: "workflowDefault" },
          expect.objectContaining({ kind: "node", nodeId: "n1", inherited: true }),
        ]),
      }),
      expect.objectContaining({
        sourceProviderId: "provider-claude",
        sourceProviderName: "Claude",
        sourceModelTier: "opus",
        sourceModelName: "claude-opus",
        occurrences: [expect.objectContaining({ kind: "node", nodeId: "n2", inherited: false })],
      }),
    ]))
  })

  it("builds a recursive V4 ZIP artifact for new exports", async () => {
    const { service } = createService()
    const artifact = await service.buildV4ExportArtifact("workflow-source")
    const parsed = readWorkflowShareArchive(artifact.archive)

    expect(parsed.manifest.format).toBe("synapse-workflow-package")
    expect(parsed.manifest.formatVersion).toBe("4.0.0")
    expect(parsed.manifest.entrypoints).toHaveLength(1)
    expect(parsed.manifest.workflows).toEqual([
      expect.objectContaining({ sourceWorkflowId: "workflow-source", sourceRevision: "v_old", schemaVersion: "2.0.0" }),
    ])
    expect(parsed.manifest.requiredCapabilities.map((capability) => capability.id)).toEqual(expect.arrayContaining([
      "workflow.node.end",
      "workflow.node.prompt",
    ]))
    const exportedWorkflow = Object.values(parsed.workflows)[0]
    expect(exportedWorkflow.id).toBe("workflow-source")
    expect(exportedWorkflow.layoutDirection).toBe("vertical")
    expect(exportedWorkflow.nodes.map((node) => node.position))
      .toEqual(workflowDefinition().nodes.map((node) => node.position))
    expect(JSON.stringify(parsed.manifest.references)).not.toContain("provider-deepseek")
    expect(JSON.stringify(parsed.manifest.references)).not.toContain("exporter-project")
    expect(JSON.stringify(exportedWorkflow)).not.toContain("provider-deepseek")
    expect(JSON.stringify(exportedWorkflow)).not.toContain("provider-claude")
    expect(JSON.stringify(exportedWorkflow)).not.toContain("exporter-project")
    expect(JSON.stringify(exportedWorkflow)).not.toContain("exporter-node-project")
  })

  it("rejects export when the confirmed preflight no longer matches", async () => {
    const { service, workflowService } = createService()
    const preflight = await service.buildExportPreflight("workflow-source")
    workflowService.getExportDocument.mockResolvedValue({
      kind: "current",
      document: { ...workflowDefinition(), version: "changed-after-preflight" },
    })

    await expect(service.buildV4ExportArtifact(
      "workflow-source",
      preflight.shareNote,
      preflight.packageDigestSeed,
    )).rejects.toThrow("重新预检")
  })

  it("exports a future-schema workflow without interpreting or rewriting its raw document", async () => {
    const { service, workflowService, providerService } = createService()
    const futureDocument = {
      id: "future-workflow",
      name: "Future Workflow",
      meta: { schemaVersion: "2.0.0" },
      futureOnly: { mode: "preserve-exactly" },
    }
    workflowService.getExportDocument.mockResolvedValue({
      kind: "future",
      document: futureDocument,
      sourceVersion: "2.0.0",
    })

    const artifact = await service.buildExportArtifact(futureDocument.id)

    expect(artifact).toEqual({
      kind: "future-raw",
      document: futureDocument,
      sourceVersion: "2.0.0",
      workflowName: "Future Workflow",
    })
    await expect(service.buildExportPackage(futureDocument.id))
      .rejects.toThrow("requires raw export")
    expect(providerService.listProviders).not.toHaveBeenCalled()
  })

  it("builds a protected raw artifact from a legacy migration diagnostic", async () => {
    const { service, workflowService, providerService } = createService()
    const futureDocument = {
      id: "legacy-future-workflow",
      name: "Legacy Future Workflow",
      meta: { schemaVersion: "3.0.0" },
      futureOnly: { mode: "preserve-exactly" },
    }
    workflowService.getLegacyMigrationExportDocument.mockResolvedValue({
      kind: "future",
      document: futureDocument,
      sourceVersion: "3.0.0",
    })

    await expect(service.buildExportArtifact(futureDocument.id, `legacy:${futureDocument.id}`))
      .resolves.toEqual({
        kind: "future-raw",
        document: futureDocument,
        sourceVersion: "3.0.0",
        workflowName: "Legacy Future Workflow",
      })
    expect(workflowService.getLegacyMigrationExportDocument)
      .toHaveBeenCalledWith(`legacy:${futureDocument.id}`)
    expect(workflowService.getExportDocument).not.toHaveBeenCalled()
    expect(providerService.listProviders).not.toHaveBeenCalled()
  })

  it("does not export model references for Code X-only workflows with a default provider", async () => {
    const { service } = createService()
    const pkg = currentPackage(await service.buildExportPackage("codex-source"))

    expect(pkg.workflow).toMatchObject({
      id: "codex-source",
      defaultProviderId: "provider-deepseek",
      defaultModelTier: "sonnet",
    })
    expect(pkg.modelReferences).toEqual([])
  })

  it("builds an import preview with provider options and suggested mappings", async () => {
    const { service } = createService()
    const pkg = currentPackage(await service.buildExportPackage("workflow-source"))
    const preview = await service.buildImportPreview("/tmp/shared.synapse-workflow.json", pkg, "sha256:preview")

    expect(preview.packagePath).toBe("/tmp/shared.synapse-workflow.json")
    expect(preview.packageDigest).toBe("sha256:preview")
    expect(preview.workflow).toEqual({
      id: "workflow-source",
      name: "Shared Workflow",
      nodeCount: 3,
      modelReferenceCount: 2,
      requiresProjectMapping: true,
    })
    expect(preview.providerOptions.map((p) => p.providerId)).toEqual([
      "provider-deepseek",
      "provider-claude",
      "local-openai",
    ])
    expect(preview.suggestedMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetProviderId: "provider-deepseek", targetModelTier: "sonnet" }),
      expect.objectContaining({ targetProviderId: "provider-claude", targetModelTier: "opus" }),
    ]))
  })

  it("requires project mapping for Code X-only workflow packages", async () => {
    const { service } = createService()
    const preview = await service.buildImportPreview("/tmp/codex.synapse-workflow.json", codexOnlyPackage(), "sha256:codex")

    expect(preview.workflow).toEqual({
      id: "codex-source",
      name: "Code X Workflow",
      nodeCount: 2,
      modelReferenceCount: 0,
      requiresProjectMapping: true,
    })
    expect(preview.modelReferences).toEqual([])
    expect(preview.suggestedMappings).toEqual([])
  })

  it("imports as a new workflow and preserves inherited provider structure", async () => {
    const { service, saved } = createService()
    const pkg = currentPackage(await service.buildExportPackage("workflow-source"))
    const mappings: WorkflowModelMapping[] = pkg.modelReferences.map((ref) => ({
      sourceRefId: ref.id,
      targetProviderId: "local-openai",
      targetModelTier: ref.sourceModelTier === "opus" ? "opus" : "sonnet",
    }))

    const result = await service.importPackage(pkg, mappings, { targetProjectId: "local-project" })

    expect(result).toEqual({ workflowId: "workflow-imported", versionHash: "v_imported" })
    expect(logger.info).toHaveBeenCalledWith("workflow package import succeeded", {
      sourceWorkflowId: "workflow-source",
      workflowId: "workflow-imported",
      modelReferenceCount: 2,
      mappingCount: 2,
      nodeCount: 3,
      versionHash: "v_imported",
    })
    expect(saved).toHaveLength(1)
    const imported = saved[0]
    expect(imported.id).toBe("workflow-imported")
    expect(imported.version).toBe("")
    expect(imported.createdAt).toBe(Date.parse(nowIso))
    expect(imported.defaultProviderId).toBe("local-openai")
    expect(imported.defaultModelTier).toBe("sonnet")
    expect(imported.defaultProjectId).toBe("local-project")
    expect(imported.layoutDirection).toBe("vertical")
    expect(imported.nodes.map((node) => node.position))
      .toEqual(workflowDefinition().nodes.map((node) => node.position))
    expect(imported.nodes.find((node) => node.id === "n1")?.config.projectId).toBeUndefined()
    expect(imported.nodes.find((node) => node.id === "n1")?.config.providerId).toBeUndefined()
    expect(imported.nodes.find((node) => node.id === "n2")?.config.providerId).toBe("local-openai")
    expect(imported.nodes.find((node) => node.id === "n2")?.config.modelTier).toBe("opus")
  })

  it("clears Code X node project ids when importing mixed workflows", async () => {
    const { service, saved } = createService()
    const pkg = currentPackage(await service.buildExportPackage("workflow-source"))
    const mixedPkg: SynapseWorkflowPackageV3 = {
      ...pkg,
      workflow: {
        ...pkg.workflow,
        nodes: [
          ...pkg.workflow.nodes,
          {
            id: "codex-1",
            name: "Code X",
            type: "codex",
            position: { x: 600, y: 0 },
            config: {
              ...structuredClone(defaultCodexNodeConfig),
              prompt: "Run codex",
              projectId: "exporter-codex-project",
            },
          },
        ],
      },
    }
    const mappings: WorkflowModelMapping[] = mixedPkg.modelReferences.map((ref) => ({
      sourceRefId: ref.id,
      targetProviderId: "local-openai",
      targetModelTier: ref.sourceModelTier,
    }))

    const result = await service.importPackage(mixedPkg, mappings, { targetProjectId: "local-project" })

    expect(result).toEqual({ workflowId: "workflow-imported", versionHash: "v_imported" })
    expect(saved[0]?.defaultProjectId).toBe("local-project")
    expect(saved[0]?.nodes.find((node) => node.id === "codex-1")?.config.projectId).toBeUndefined()
  })

  it("blocks importing model workflows without a local project mapping", async () => {
    const { service, saved } = createService()
    const pkg = currentPackage(await service.buildExportPackage("workflow-source"))
    const mappings: WorkflowModelMapping[] = pkg.modelReferences.map((ref) => ({
      sourceRefId: ref.id,
      targetProviderId: "local-openai",
      targetModelTier: "default",
    }))

    await expect(service.importPackage(pkg, mappings)).resolves.toEqual({
      errors: [{
        type: "invalid_config",
        field: "defaultProjectId",
        message: "请选择项目。",
        retryable: true,
      }],
    })
    expect(saved).toHaveLength(0)
  })

  it("imports Code X-only workflows with a target project mapping", async () => {
    const { service, saved } = createService()

    const result = await service.importPackage(codexOnlyPackage(), [], { targetProjectId: "local-project" })

    expect(result).toEqual({ workflowId: "workflow-imported", versionHash: "v_imported" })
    expect(saved).toHaveLength(1)
    expect(saved[0]?.defaultProjectId).toBe("local-project")
    expect(saved[0]?.nodes.find((node) => node.id === "codex-1")?.config.projectId).toBeUndefined()
  })

  it("requires project mapping and clears Claude Code project ids when importing Claude Code-only workflows", async () => {
    const { service, saved } = createService()
    const preview = await service.buildImportPreview("/tmp/claude-code.synapse-workflow.json", claudeCodeOnlyPackage(), "sha256:claude-code")

    expect(preview.workflow).toEqual({
      id: "claude-code-source",
      name: "Claude Code Workflow",
      nodeCount: 2,
      modelReferenceCount: 0,
      requiresProjectMapping: true,
    })

    await expect(service.importPackage(claudeCodeOnlyPackage(), [])).resolves.toEqual({
      errors: [{
        type: "invalid_config",
        field: "defaultProjectId",
        message: "请选择项目。",
        retryable: true,
      }],
    })

    const result = await service.importPackage(claudeCodeOnlyPackage(), [], { targetProjectId: "local-project" })

    expect(result).toEqual({ workflowId: "workflow-imported", versionHash: "v_imported" })
    expect(saved).toHaveLength(1)
    expect(saved[0]?.defaultProjectId).toBe("local-project")
    expect(saved[0]?.nodes.find((node) => node.id === "claude-code-1")?.config.projectId).toBeUndefined()
  })

  it("blocks importing Code X-only workflows without a local project mapping", async () => {
    const { service, saved } = createService()

    await expect(service.importPackage(codexOnlyPackage(), [])).resolves.toEqual({
      errors: [{
        type: "invalid_config",
        field: "defaultProjectId",
        message: "请选择项目。",
        retryable: true,
      }],
    })
    expect(saved).toHaveLength(0)
  })

  it("rejects import when a model reference has no mapping", async () => {
    const { service } = createService()
    const pkg = currentPackage(await service.buildExportPackage("workflow-source"))

    await expect(service.importPackage(pkg, [])).rejects.toThrow(/Missing model mapping/)
    expect(logger.warn).toHaveBeenCalledWith("workflow package import missing model mapping", {
      sourceWorkflowId: "workflow-source",
      sourceRefId: "model-ref-1",
      modelReferenceCount: 2,
      mappingCount: 0,
    })
  })

  it("rejects import when a mapping targets an unknown provider", async () => {
    const { service } = createService()
    const pkg = currentPackage(await service.buildExportPackage("workflow-source"))
    const mappings = pkg.modelReferences.map((ref) => ({
      sourceRefId: ref.id,
      targetProviderId: "missing-provider",
      targetModelTier: "default" as const,
    }))

    await expect(service.importPackage(pkg, mappings)).rejects.toThrow(/Unknown target provider/)
  })

  it("adapts legacy packages into the V4 plan and rejects legacy packages with missing child bodies", async () => {
    const { service } = createService()
    const legacy: SynapseWorkflowPackageV1 = {
      format: "synapse-workflow-package-v1",
      exportedAt: nowIso,
      workflow: workflowDefinition(),
      modelReferences: [{
        id: "legacy-model",
        sourceProviderName: "DeepSeek",
        sourceModelTier: "sonnet",
        sourceModelName: "deepseek-chat",
        occurrences: [{ kind: "workflowDefault" }],
      }],
    }

    const adapted = await service.adaptLegacyPackageToV4(legacy, "sha256:legacy")

    expect(adapted.manifest.formatVersion).toBe("4.0.0")
    expect(adapted.manifest.extensions).toEqual({ legacyFormat: "synapse-workflow-package-v1" })
    expect(adapted.manifest.references.models).toContainEqual(expect.objectContaining({
      sourceProviderName: "DeepSeek",
      sourceModelName: "deepseek-chat",
    }))

    const withChild: SynapseWorkflowPackageV1 = {
      ...legacy,
      workflow: {
        ...legacy.workflow,
        nodes: [
          ...legacy.workflow.nodes,
          {
            id: "call-child",
            name: "调用子工作流",
            type: "workflow_call",
            position: { x: 600, y: 0 },
            config: { workflowId: "child-workflow", variables: [], paramTemplates: {}, paramBindings: {} },
          },
        ],
      },
    }
    await expect(service.adaptLegacyPackageToV4(withChild, "sha256:child")).rejects.toThrow("未包含子工作流")
  })

  it("plans cleanup only for imported children without references or history", async () => {
    const service = new WorkflowPackageService({
      workflowService: {
        getExportDocument: vi.fn(),
        getLegacyMigrationExportDocument: vi.fn(),
        save: vi.fn(),
        commitAtomicBatch: vi.fn(),
      },
      shareStateService: {
        initialize: vi.fn(),
        findOriginByWorkflowId: vi.fn(async () => ({
          id: "origin:lineage-1",
          schemaVersion: 1,
          recordType: "origin",
          lineageId: "lineage-1",
          artifactId: "artifact-1",
          packageDigest: "sha256:test",
          sourceRevisions: { root: "v1", safe: "v1", retained: "v1" },
          workflowIds: { root: "workflow-root", safe: "workflow-safe", retained: "workflow-retained" },
          entrypointRefs: ["root"],
          selections: { models: [], projects: [], resources: [], environments: [] },
          importedAt: 1,
        })),
      } as never,
      providerService: { listProviders: vi.fn(async () => []) },
      permissionGuard: { check: vi.fn(async () => ({ allowed: true as const })) },
      auditSink: { record: vi.fn() },
      inspectDeleteCandidates: vi.fn(async () => new Map([
        ["workflow-safe", { name: "可清理", hasReference: false, hasHistory: false }],
        ["workflow-retained", { name: "保留", hasReference: false, hasHistory: true }],
      ])),
    })

    await expect(service.buildDeletePlan("workflow-root")).resolves.toEqual(expect.objectContaining({
      imported: true,
      isEntrypoint: true,
      cleanupCandidates: [{ workflowId: "workflow-safe", name: "可清理" }],
      retainedChildren: [{ workflowId: "workflow-retained", name: "保留", reason: "history" }],
    }))
  })
})
