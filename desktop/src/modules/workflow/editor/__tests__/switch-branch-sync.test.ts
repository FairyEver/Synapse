import { describe, expect, it } from "vitest"

import type { WorkflowEdge } from "@/types/workflow"
import { syncSwitchBranchReferences } from "../switch-branch-sync"

describe("syncSwitchBranchReferences", () => {
  it("renames switch edge branches and defaultBranch when a branch key changes", () => {
    const edges: WorkflowEdge[] = [
      { id: "edge-1", from: "switch-1", to: "prompt-1", branch: "branch1" },
      { id: "edge-2", from: "prompt-1", to: "end-1" },
    ]

    const result = syncSwitchBranchReferences({
      nodeId: "switch-1",
      previousConfig: {
        branches: [
          { id: "branch1", label: "通过" },
          { id: "branch2", label: "拒绝" },
        ],
        defaultBranch: "branch1",
      },
      nextConfig: {
        branches: [
          { id: "approved", label: "通过" },
          { id: "branch2", label: "拒绝" },
        ],
        defaultBranch: "branch1",
      },
      edges,
    })

    expect(result.config.defaultBranch).toBe("approved")
    expect(result.edges).toEqual([
      { id: "edge-1", from: "switch-1", to: "prompt-1", branch: "approved" },
      { id: "edge-2", from: "prompt-1", to: "end-1" },
    ])
    expect(result.orphanedEdgeIds).toEqual([])
  })

  it("removes edges for deleted branches without treating deletion as a rename", () => {
    const edges: WorkflowEdge[] = [
      { id: "edge-1", from: "switch-1", to: "prompt-1", branch: "branch1" },
      { id: "edge-2", from: "switch-1", to: "prompt-2", branch: "branch2" },
    ]

    const result = syncSwitchBranchReferences({
      nodeId: "switch-1",
      previousConfig: {
        branches: [
          { id: "branch1", label: "通过" },
          { id: "branch2", label: "拒绝" },
        ],
        defaultBranch: "branch2",
      },
      nextConfig: {
        branches: [
          { id: "branch2", label: "拒绝" },
        ],
        defaultBranch: "branch2",
      },
      edges,
    })

    expect(result.config.defaultBranch).toBe("branch2")
    expect(result.edges).toEqual([
      { id: "edge-2", from: "switch-1", to: "prompt-2", branch: "branch2" },
    ])
    expect(result.orphanedEdgeIds).toEqual(["edge-1"])
  })
})
