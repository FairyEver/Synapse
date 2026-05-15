import { describe, expect, it } from "vitest"

import {
  ProviderReferenceScanner,
  type ProviderReferenceScannerDeps,
  type TaskActionRef,
} from "../provider-reference-scanner"

function makeDeps(overrides: Partial<ProviderReferenceScannerDeps> = {}): ProviderReferenceScannerDeps {
  return {
    listTasks: async () => [],
    updateTaskAction: async () => {},
    listWorkflowNodes: async () => [],
    updateWorkflowNodeProvider: async () => {},
    listConversations: async () => [],
    ...overrides,
  }
}

describe("ProviderReferenceScanner", () => {
  describe("scan", () => {
    it("returns empty result when no references exist", async () => {
      const scanner = new ProviderReferenceScanner(makeDeps())
      const result = await scanner.scan("some-provider")
      expect(result).toEqual({
        providerId: "some-provider",
        references: [],
        taskCount: 0,
        workflowNodeCount: 0,
        conversationCount: 0,
      })
    })

    it("finds references in tasks", async () => {
      const scanner = new ProviderReferenceScanner(makeDeps({
        listTasks: async () => [
          { id: "task-1", name: "Daily Review", action: { type: "builtin.agent", config: { providerId: "target", modelTier: "sonnet" } } },
          { id: "task-2", name: "Other", action: { type: "builtin.agent", config: { providerId: "other", modelTier: "default" } } },
        ],
      }))
      const result = await scanner.scan("target")
      expect(result.taskCount).toBe(1)
      expect(result.references).toEqual([
        expect.objectContaining({ kind: "scheduled-task", entityId: "task-1", entityName: "Daily Review" }),
      ])
    })

    it("finds references in workflow nodes", async () => {
      const scanner = new ProviderReferenceScanner(makeDeps({
        listWorkflowNodes: async () => [
          { workflowId: "wf-1", workflowName: "Assistant", nodeId: "n-1", nodeName: "Prompt", providerId: "target", modelTier: "opus" },
        ],
      }))
      const result = await scanner.scan("target")
      expect(result.workflowNodeCount).toBe(1)
      expect(result.references).toEqual([
        expect.objectContaining({ kind: "workflow-node", entityId: "wf-1", nodeId: "n-1" }),
      ])
    })

    it("finds references in conversations", async () => {
      const scanner = new ProviderReferenceScanner(makeDeps({
        listConversations: async () => [
          { id: "conv-1", name: "Chat 1", providerId: "target" },
          { id: "conv-2", name: "Chat 2", providerId: "other" },
        ],
      }))
      const result = await scanner.scan("target")
      expect(result.conversationCount).toBe(1)
    })
  })

  describe("migrate", () => {
    it("updates matching tasks and workflow nodes", async () => {
      const updatedTasks: Array<{ id: string; action: unknown }> = []
      const updatedNodes: Array<{ workflowId: string; nodeId: string; providerId: string; modelTier: string }> = []

      const scanner = new ProviderReferenceScanner(makeDeps({
        listTasks: async () => [
          { id: "task-1", name: "T1", action: { type: "builtin.agent", config: { providerId: "source", modelTier: "sonnet", prompt: "hello" } } },
        ],
        updateTaskAction: async (id: string, action: TaskActionRef) => { updatedTasks.push({ id, action }) },
        listWorkflowNodes: async () => [
          { workflowId: "wf-1", workflowName: "W1", nodeId: "n-1", nodeName: "N1", providerId: "source", modelTier: "opus" },
        ],
        updateWorkflowNodeProvider: async (wId: string, nId: string, pId: string, tier: string) => { updatedNodes.push({ workflowId: wId, nodeId: nId, providerId: pId, modelTier: tier }) },
        listConversations: async () => [],
      }))

      const result = await scanner.migrate({
        sourceProviderId: "source",
        targetProviderId: "new-provider",
        targetModelTier: "sonnet",
        scope: ["scheduled-task", "workflow-node"],
      })

      expect(result.migratedTasks).toBe(1)
      expect(result.migratedWorkflowNodes).toBe(1)
      expect(result.errors).toEqual([])
      expect(updatedTasks[0]).toEqual({
        id: "task-1",
        action: { type: "builtin.agent", config: { providerId: "new-provider", modelTier: "sonnet", prompt: "hello" } },
      })
      expect(updatedNodes[0]).toEqual({
        workflowId: "wf-1", nodeId: "n-1", providerId: "new-provider", modelTier: "sonnet",
      })
    })
  })
})
