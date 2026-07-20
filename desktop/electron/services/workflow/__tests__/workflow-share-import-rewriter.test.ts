import { describe, expect, it } from "vitest"
import type { WorkflowDefinition } from "../../../../src/types/workflow"
import type { WorkflowSharePackageV4 } from "../../../../src/types/workflow-package"
import "../../../../workflow-nodes/register.renderer"
import { collectWorkflowShareDependencies } from "../workflow-share-dependency-collector"
import { stableWorkflowReference } from "../workflow-share-graph"
import { rewriteWorkflowSharePackage } from "../workflow-share-import-rewriter"

function child(): WorkflowDefinition {
  return {
    id: "child-source",
    name: "Child",
    version: "v-child",
    meta: { schemaVersion: "2.0.0" },
    createdAt: 1,
    updatedAt: 2,
    params: [],
    nodes: [{ id: "end", name: "End", type: "end", position: { x: 0, y: 0 }, config: { outputType: "text", template: "", variables: [] } }],
    edges: [],
  }
}

function root(): WorkflowDefinition {
  return {
    id: "root-source",
    name: "Root",
    version: "v-root",
    meta: { schemaVersion: "2.0.0" },
    createdAt: 1,
    updatedAt: 2,
    defaultProviderId: "provider-source",
    defaultModelTier: "sonnet",
    defaultProjectId: "project-source",
    params: [{ name: "input", type: "file", default: { kind: "local_path", entryType: "file", path: "/source/input.txt" } }],
    nodes: [
      { id: "prompt", name: "Prompt", type: "prompt", position: { x: 0, y: 0 }, config: { prompt: "p", variables: [] } },
      { id: "call", name: "Call", type: "workflow_call", position: { x: 100, y: 0 }, config: { workflowId: "child-source", variables: [], paramTemplates: {}, paramBindings: {} } },
      { id: "end", name: "End", type: "end", position: { x: 200, y: 0 }, config: { outputType: "text", template: "", variables: [] } },
    ],
    edges: [],
  }
}

function packageData(): WorkflowSharePackageV4 {
  const workflows = [root(), child()]
  const workflowRefs = new Map(workflows.map((workflow) => [workflow.id, stableWorkflowReference(workflow.id)]))
  const collected = collectWorkflowShareDependencies({
    workflows,
    workflowRefs,
    providers: [{ id: "provider-source", name: "Source", sonnetModel: "source-model" }],
    projects: [{ id: "project-source", name: "Source Project" }],
  })
  const items = workflows.map((workflow) => ({
    ref: workflowRefs.get(workflow.id)!,
    sourceWorkflowId: workflow.id,
    sourceRevision: workflow.version,
    schemaVersion: workflow.meta!.schemaVersion,
    path: `workflows/${workflowRefs.get(workflow.id)!}.json`,
  }))
  return {
    manifest: {
      format: "synapse-workflow-package",
      formatVersion: "4.0.0",
      artifactId: "artifact",
      lineageId: "lineage",
      exportedAt: "2026-07-19T00:00:00.000Z",
      createdWith: { appVersion: "test" },
      entrypoints: [workflowRefs.get("root-source")!],
      workflows: items,
      references: collected.references,
      requiredCapabilities: collected.requiredCapabilities,
      risks: collected.risks,
      files: [],
    },
    workflows: Object.fromEntries(workflows.map((workflow) => [workflowRefs.get(workflow.id)!, workflow])),
  }
}

describe("rewriteWorkflowSharePackage", () => {
  it("allocates local ids and rewrites the whole dependency set", () => {
    const pkg = packageData()
    const ids = ["root-local", "child-local"]
    const modelRef = pkg.manifest.references.models[0]
    const projectRef = pkg.manifest.references.projects[0]
    const resourceRef = pkg.manifest.references.resources[0]
    const result = rewriteWorkflowSharePackage({
      package: pkg,
      createId: () => ids.shift()!,
      now: 100,
      selections: {
        models: [{ sourceRefId: modelRef.id, action: "map", targetProviderId: "provider-local", targetModelTier: "default" }],
        projects: [{ sourceRefId: projectRef.id, targetProjectId: "project-local" }],
        resources: [{ sourceRefId: resourceRef.id, target: { kind: "local_path", path: "/local/input.txt" } }],
        environments: [],
      },
    })

    expect(result.definitions.map((definition) => definition.name)).toEqual(["Child", "Root"])
    const importedRoot = result.definitions[1]
    expect(importedRoot).toMatchObject({
      id: "root-local",
      version: "",
      createdAt: 100,
      updatedAt: 100,
      defaultProviderId: "provider-local",
      defaultModelTier: "default",
      defaultProjectId: "project-local",
    })
    expect(importedRoot.nodes.find((node) => node.id === "call")?.config.workflowId).toBe("child-local")
    expect(importedRoot.params[0].default).toEqual({ kind: "local_path", entryType: "file", path: "/local/input.txt" })
    expect(result.entrypointIds).toEqual(["root-local"])
  })

  it("refuses incomplete mappings before mutating definitions", () => {
    const pkg = packageData()
    expect(() => rewriteWorkflowSharePackage({
      package: pkg,
      createId: () => "id",
      now: 100,
      selections: { models: [], projects: [], resources: [], environments: [] },
    })).toThrow("缺少模型映射")
  })
})
