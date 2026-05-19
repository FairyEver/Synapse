import { describe, expect, it, vi } from "vitest"
import type { WorkflowDefinition } from "../../../src/types/workflow"
import type { WorkflowModelMapping } from "../../../src/types/workflow-package"
import type { CCProvider } from "../provider/types"
import { WorkflowPackageService } from "../workflow/workflow-package-service"

const nowIso = "2026-05-19T10:00:00.000Z"

function workflowDefinition(): WorkflowDefinition {
  return {
    id: "workflow-source",
    name: "Shared Workflow",
    version: "v_old",
    createdAt: 1,
    updatedAt: 2,
    defaultProviderId: "provider-deepseek",
    defaultModelTier: "sonnet",
    params: [],
    nodes: [
      {
        id: "n1",
        name: "分析",
        type: "prompt",
        position: { x: 0, y: 0 },
        config: { prompt: "Analyze", variables: [] },
      },
      {
        id: "n2",
        name: "终审",
        type: "prompt",
        position: { x: 200, y: 0 },
        config: { providerId: "provider-claude", modelTier: "opus", prompt: "Review", variables: [] },
      },
      {
        id: "end",
        name: "结束",
        type: "end",
        position: { x: 400, y: 0 },
        config: { outputType: "text", template: "", variables: [] },
      },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2" },
      { id: "e2", from: "n2", to: "end" },
    ],
  }
}

function createService() {
  const saved: WorkflowDefinition[] = []
  const workflowService = {
    get: vi.fn(async (id: string) => id === "workflow-source" ? workflowDefinition() : null),
    save: vi.fn(async (def: WorkflowDefinition) => {
      saved.push(def)
      return { versionHash: "v_imported" }
    }),
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
    now: () => new Date(nowIso),
    createId: () => "workflow-imported",
  })
  return { service, workflowService, providerService, saved }
}

describe("WorkflowPackageService", () => {
  it("builds an export package with grouped model references", async () => {
    const { service } = createService()
    const pkg = await service.buildExportPackage("workflow-source")

    expect(pkg.format).toBe("synapse-workflow-package-v1")
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

  it("builds an import preview with provider options and suggested mappings", async () => {
    const { service } = createService()
    const pkg = await service.buildExportPackage("workflow-source")
    const preview = await service.buildImportPreview("/tmp/shared.synapse-workflow.json", pkg)

    expect(preview.packagePath).toBe("/tmp/shared.synapse-workflow.json")
    expect(preview.workflow).toEqual({
      id: "workflow-source",
      name: "Shared Workflow",
      nodeCount: 3,
      modelReferenceCount: 2,
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

  it("imports as a new workflow and preserves inherited provider structure", async () => {
    const { service, saved } = createService()
    const pkg = await service.buildExportPackage("workflow-source")
    const mappings: WorkflowModelMapping[] = pkg.modelReferences.map((ref) => ({
      sourceRefId: ref.id,
      targetProviderId: "local-openai",
      targetModelTier: ref.sourceModelTier === "opus" ? "opus" : "sonnet",
    }))

    const result = await service.importPackage(pkg, mappings)

    expect(result).toEqual({ workflowId: "workflow-imported", versionHash: "v_imported" })
    expect(saved).toHaveLength(1)
    const imported = saved[0]
    expect(imported.id).toBe("workflow-imported")
    expect(imported.version).toBe("")
    expect(imported.createdAt).toBe(Date.parse(nowIso))
    expect(imported.defaultProviderId).toBe("local-openai")
    expect(imported.defaultModelTier).toBe("sonnet")
    expect(imported.nodes.find((node) => node.id === "n1")?.config.providerId).toBeUndefined()
    expect(imported.nodes.find((node) => node.id === "n2")?.config.providerId).toBe("local-openai")
    expect(imported.nodes.find((node) => node.id === "n2")?.config.modelTier).toBe("opus")
  })

  it("rejects import when a model reference has no mapping", async () => {
    const { service } = createService()
    const pkg = await service.buildExportPackage("workflow-source")

    await expect(service.importPackage(pkg, [])).rejects.toThrow(/Missing model mapping/)
  })

  it("rejects import when a mapping targets an unknown provider", async () => {
    const { service } = createService()
    const pkg = await service.buildExportPackage("workflow-source")
    const mappings = pkg.modelReferences.map((ref) => ({
      sourceRefId: ref.id,
      targetProviderId: "missing-provider",
      targetModelTier: "default" as const,
    }))

    await expect(service.importPackage(pkg, mappings)).rejects.toThrow(/Unknown target provider/)
  })
})
