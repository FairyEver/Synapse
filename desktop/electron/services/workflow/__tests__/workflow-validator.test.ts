import { describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition } from "../../../../src/types/workflow"
import { validateWorkflow } from "../workflow-validator"
import "../../../../workflow-nodes/register.main"

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))
vi.mock("../../log-store", () => ({
  createMainLogger: () => logger,
}))

describe("validateWorkflow", () => {
  it("rejects disconnected nodes as validation errors", () => {
    const result = validateWorkflow(definitionWithDisconnectedNode())

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "disconnected_node",
        nodeId: "orphan",
        message: '节点 "Orphan" 未连接',
      }),
    ]))
    expect(result.warnings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "disconnected_node" }),
    ]))
  })
})

function definitionWithDisconnectedNode(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Workflow",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    params: [],
    nodes: [
      {
        id: "script-1",
        name: "Run",
        type: "script",
        position: { x: 0, y: 0 },
        config: { shell: "posix", script: "echo ok", variables: [] },
      },
      {
        id: "end",
        name: "End",
        type: "end",
        position: { x: 200, y: 0 },
        config: { outputType: "text", template: "", variables: [] },
      },
      {
        id: "orphan",
        name: "Orphan",
        type: "script",
        position: { x: 0, y: 120 },
        config: { shell: "posix", script: "echo skipped", variables: [] },
      },
    ],
    edges: [{ id: "edge-1", from: "script-1", to: "end" }],
  }
}
