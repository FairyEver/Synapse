import { describe, expect, it, vi } from "vitest"
import type { AgentPersonaService } from "../../../../app-capabilities/agent-personas/main/service"
import type { WorkflowDefinition } from "../../../../src/types/workflow"
import type { DataRepository } from "../../../runtime/data-repo"
import type { WorkflowService } from "../../workflow/workflow-service"

import {
  ProviderReferenceScanner,
  type ProviderReferenceScannerDeps,
} from "../provider-reference-scanner"
import { createProviderReferenceScannerDeps } from "../provider-reference-scanner-deps"

function makeDeps(overrides: Partial<ProviderReferenceScannerDeps> = {}): ProviderReferenceScannerDeps {
  return {
    listWorkflowNodes: async () => [],
    updateWorkflowNodeProvider: async () => {},
    listConversations: async () => [],
    listAgentPersonas: async () => [],
    ...overrides,
  }
}

describe("ProviderReferenceScanner", () => {
  it("builds one registry-backed dependency set for workflow defaults, conversations, and current personas", async () => {
    const definition = {
      id: "workflow-1",
      name: "日报",
      nodes: [],
      defaultProviderId: "source-provider",
      defaultModelTier: "sonnet",
    } as unknown as WorkflowDefinition
    const save = vi.fn(async () => undefined)
    const workflowService = {
      list: vi.fn(async () => [{ id: definition.id }]),
      get: vi.fn(async () => definition),
      save,
    } as unknown as WorkflowService
    const dataRepository = {
      namespace: () => ({
        list: vi.fn(async () => [{ id: "conversation-1", name: "会话", projectId: "project-1", providerId: "source-provider" }]),
      }),
    } as unknown as DataRepository
    const agentPersonaService = {
      listCached: vi.fn(async () => [{
        id: "persona-1",
        name: "翻译",
        providerModel: { providerId: "source-provider", modelTier: "sonnet" },
      }]),
    } as unknown as AgentPersonaService
    const services = new Map<string, unknown>([
      ["core.workflow", workflowService],
      ["core.data-repository", dataRepository],
      ["core.agent-personas", agentPersonaService],
    ])
    const deps = createProviderReferenceScannerDeps(<T>(id: string) => services.get(id) as T)

    await expect(deps.listWorkflowNodes()).resolves.toEqual([expect.objectContaining({
      nodeId: "",
      nodeName: "工作流默认供应商",
      providerId: "source-provider",
      modelTier: "sonnet",
    })])
    await expect(deps.listConversations()).resolves.toEqual([
      expect.objectContaining({ id: "conversation-1", projectId: "project-1" }),
    ])
    await expect(deps.listAgentPersonas()).resolves.toEqual([expect.objectContaining({ id: "persona-1" })])

    await deps.updateWorkflowNodeProvider("workflow-1", "", "target-provider", "opus")
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      defaultProviderId: "target-provider",
      defaultModelTier: "opus",
    }))
  })

  describe("scan", () => {
    it("returns empty result when no references exist", async () => {
      const scanner = new ProviderReferenceScanner(makeDeps())
      const result = await scanner.scan("some-provider")
      expect(result).toEqual({
        providerId: "some-provider",
        references: [],
        workflowNodeCount: 0,
        conversationCount: 0,
        agentPersonaCount: 0,
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
          { id: "conv-1", name: "Chat 1", projectId: "project-1", providerId: "target" },
          { id: "conv-2", name: "Chat 2", projectId: "project-2", providerId: "other" },
        ],
      }))
      const result = await scanner.scan("target")
      expect(result.conversationCount).toBe(1)
      expect(result.references).toEqual([
        expect.objectContaining({ kind: "conversation", entityId: "conv-1", projectId: "project-1" }),
      ])
    })

    it("finds specified model references in the current local agent persona snapshot", async () => {
      const scanner = new ProviderReferenceScanner(makeDeps({
        listAgentPersonas: async () => [
          { id: "persona-1", name: "翻译", providerModel: { providerId: "target", modelTier: "sonnet" } },
          { id: "persona-2", name: "总结", providerModel: null },
        ],
      }))

      const result = await scanner.scan("target")

      expect(result.agentPersonaCount).toBe(1)
      expect(result.references).toEqual([
        expect.objectContaining({ kind: "agent-persona", entityId: "persona-1", entityName: "翻译" }),
      ])
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
