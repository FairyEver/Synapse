import { describe, expect, it } from "vitest"
import type { WorkflowDefinition } from "../../../../src/types/workflow"
import "../../../../workflow-nodes/register.renderer"
import { collectWorkflowShareDependencies } from "../workflow-share-dependency-collector"
import { stableWorkflowReference } from "../workflow-share-graph"

function workflow(id: string, nodes: WorkflowDefinition["nodes"]): WorkflowDefinition {
  return {
    id,
    name: id,
    version: `v-${id}`,
    createdAt: 1,
    updatedAt: 2,
    layoutDirection: "horizontal",
    params: [],
    nodes,
    edges: [],
  }
}

describe("Clipboard Workflow share contract", () => {
  it("exports direct capability, risk, and sensitive declarations", () => {
    const definition = workflow("root", [
      {
        id: "read",
        name: "读取",
        type: "clipboard_text_read",
        position: { x: 0, y: 0 },
        config: {},
      },
      {
        id: "write",
        name: "写入",
        type: "clipboard_text_write",
        position: { x: 100, y: 0 },
        config: { text: "secret text", variables: [] },
      },
    ])
    const result = collectWorkflowShareDependencies({
      workflows: [definition],
      workflowRefs: new Map([[definition.id, stableWorkflowReference(definition.id)]]),
      providers: [],
    })

    expect(result.requiredCapabilities).toEqual(expect.arrayContaining([
      {
        id: "app.clipboard.text.read",
        minVersion: "1.0.0",
        installSourceId: "synapse.builtin",
      },
      {
        id: "app.clipboard.text.write",
        minVersion: "1.0.0",
        installSourceId: "synapse.builtin",
      },
    ]))
    expect(result.risks.highRiskLocations).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: "read", code: "clipboard.read" }),
      expect.objectContaining({ nodeId: "write", code: "clipboard.write" }),
    ]))
    expect(result.risks.sensitiveLocations).toContainEqual(expect.objectContaining({
      nodeId: "write",
      fieldPath: ["text"],
    }))
    expect(JSON.stringify(result.risks)).not.toContain("secret text")
  })

  it("does not let workflow_call hide child Clipboard dependencies or locations", () => {
    const root = workflow("root", [{
      id: "call",
      name: "调用子流程",
      type: "workflow_call",
      position: { x: 0, y: 0 },
      config: {
        workflowId: "child",
        variables: [],
        paramTemplates: {},
        paramBindings: {},
      },
    }])
    const child = workflow("child", [{
      id: "child-read",
      name: "读取",
      type: "clipboard_text_read",
      position: { x: 0, y: 0 },
      config: {},
    }])
    const refs = new Map([
      [root.id, stableWorkflowReference(root.id)],
      [child.id, stableWorkflowReference(child.id)],
    ])
    const result = collectWorkflowShareDependencies({
      workflows: [root, child],
      workflowRefs: refs,
      providers: [],
    })

    expect(result.requiredCapabilities).toContainEqual(expect.objectContaining({
      id: "app.clipboard.text.read",
    }))
    expect(result.risks.highRiskLocations).toContainEqual(expect.objectContaining({
      workflowRef: refs.get("child"),
      nodeId: "child-read",
      code: "clipboard.read",
    }))
  })
})
