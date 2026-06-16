import { describe, expect, it } from "vitest"

import {
  ProviderReferenceScanner,
  type ProviderReferenceScannerDeps,
} from "../provider-reference-scanner"

function makeDeps(overrides: Partial<ProviderReferenceScannerDeps> = {}): ProviderReferenceScannerDeps {
  return {
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
        workflowNodeCount: 0,
        conversationCount: 0,
      })
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
    it("updates matching workflow nodes", async () => {
      const updatedNodes: Array<{ workflowId: string; nodeId: string; providerId: string; modelTier: string }> = []

      const scanner = new ProviderReferenceScanner(makeDeps({
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
        scope: ["workflow-node"],
      })

      expect(result.migratedWorkflowNodes).toBe(1)
      expect(result.errors).toEqual([])
      expect(updatedNodes[0]).toEqual({
        workflowId: "wf-1", nodeId: "n-1", providerId: "new-provider", modelTier: "sonnet",
      })
    })
  })
})
