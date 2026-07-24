import { describe, expect, it } from "vitest"
import type { WorkflowDefinition } from "../../../../src/types/workflow"
import "../../../../workflow-nodes/register.renderer"
import type { WorkflowSharePackageV4 } from "../../../../src/types/workflow-package"
import { collectWorkflowShareGraph, stableWorkflowReference, validateWorkflowSharePackageGraph } from "../workflow-share-graph"

function definition(id: string, children: readonly string[] = []): WorkflowDefinition {
  return {
    id,
    name: id,
    version: `v-${id}`,
    meta: { schemaVersion: "2.0.0" },
    createdAt: 1,
    updatedAt: 2,
    layoutDirection: "horizontal" as const,
    params: [],
    nodes: [
      ...children.map((child, index) => ({
        id: `call-${index}`,
        name: `Call ${child}`,
        type: "workflow_call",
        position: { x: index * 100, y: 0 },
        config: { workflowId: child, variables: [], paramTemplates: {}, paramBindings: {} },
      })),
      { id: "end", name: "End", type: "end", position: { x: 500, y: 0 }, config: { outputType: "text", template: "", variables: [] } },
    ],
    edges: [],
  }
}

describe("collectWorkflowShareGraph", () => {
  it("collects diamond dependencies once and uses stable references", async () => {
    const documents = new Map([
      ["root", definition("root", ["left", "right"])],
      ["left", definition("left", ["shared"])],
      ["right", definition("right", ["shared"])],
      ["shared", definition("shared")],
    ])
    const graph = await collectWorkflowShareGraph({
      entryWorkflowIds: ["root"],
      loadWorkflow: async (id) => {
        const document = documents.get(id)
        return document ? { kind: "current", document } : null
      },
    })

    expect(graph.workflows.map((workflow) => workflow.id)).toEqual(["root", "left", "shared", "right"])
    expect(graph.entrypoints).toEqual([stableWorkflowReference("root")])
    expect(new Set(graph.workflowRefs.values()).size).toBe(4)
  })

  it("rejects cycles, missing children, future documents, and excessive depth", async () => {
    const cycle = new Map([
      ["a", definition("a", ["b"])],
      ["b", definition("b", ["a"])],
    ])
    await expect(collectWorkflowShareGraph({
      entryWorkflowIds: ["a"],
      loadWorkflow: async (id) => cycle.has(id) ? { kind: "current", document: cycle.get(id)! } : null,
    })).rejects.toThrow("形成循环")

    await expect(collectWorkflowShareGraph({
      entryWorkflowIds: ["missing"],
      loadWorkflow: async () => null,
    })).rejects.toThrow("找不到子工作流")

    await expect(collectWorkflowShareGraph({
      entryWorkflowIds: ["future"],
      loadWorkflow: async () => ({ kind: "future", document: { id: "future", meta: { schemaVersion: "9.0.0" } }, sourceVersion: "9.0.0" }),
    })).rejects.toThrow("更高的数据版本")

    const deep = new Map(Array.from({ length: 7 }, (_, index) => {
      const id = String(index)
      return [id, definition(id, index < 6 ? [String(index + 1)] : [])] as const
    }))
    await expect(collectWorkflowShareGraph({
      entryWorkflowIds: ["0"],
      loadWorkflow: async (id) => ({ kind: "current", document: deep.get(id)! }),
    })).rejects.toThrow("超过 5 层")
  })
})

describe("validateWorkflowSharePackageGraph", () => {
  function packageWith(documents: readonly WorkflowDefinition[], entrypointId = documents[0]?.id): WorkflowSharePackageV4 {
    const workflows = documents.map((document) => ({
      ref: stableWorkflowReference(document.id),
      sourceWorkflowId: document.id,
      sourceRevision: document.version,
      schemaVersion: document.meta!.schemaVersion,
      path: `workflows/${stableWorkflowReference(document.id)}.json`,
    }))
    return {
      manifest: {
        format: "synapse-workflow-package",
        formatVersion: "4.0.0",
        artifactId: "artifact",
        lineageId: "lineage",
        exportedAt: "2026-07-19T00:00:00.000Z",
        createdWith: { appVersion: "test" },
        entrypoints: [stableWorkflowReference(entrypointId!)],
        workflows,
        references: { models: [], projects: [], resources: [], environments: [], runtimes: [] },
        requiredCapabilities: [],
        risks: { sensitiveLocations: [], highRiskLocations: [], portabilityWarnings: [], excludedAutomationCount: 0 },
        files: workflows.map((item) => ({ path: item.path, size: 0, sha256: "0".repeat(64), mediaType: "application/json" })),
      },
      workflows: Object.fromEntries(documents.map((document) => [stableWorkflowReference(document.id), document])),
    }
  }

  it("rejects missing, cyclic, too-deep, and unreachable package members", () => {
    expect(() => validateWorkflowSharePackageGraph(packageWith([definition("root", ["missing"])]))).toThrow("未包含在分享包")
    expect(() => validateWorkflowSharePackageGraph(packageWith([
      definition("a", ["b"]),
      definition("b", ["a"]),
    ]))).toThrow("形成循环")
    const deep = Array.from({ length: 6 }, (_, index) => definition(String(index), index < 5 ? [String(index + 1)] : []))
    expect(() => validateWorkflowSharePackageGraph(packageWith(deep))).toThrow("超过 5 层")
    expect(() => validateWorkflowSharePackageGraph(packageWith([
      definition("root"),
      definition("orphan"),
    ]))).toThrow("入口无法到达")
  })
})
