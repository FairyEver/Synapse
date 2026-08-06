import type { AgentPersonaService } from "../../../app-capabilities/agent-personas/main/service"
import type { WorkflowDefinition } from "../../../src/types/workflow"
import type { ModelTier } from "../../../src/types/provider-model"
import type { ConversationEntryV1, DataRepository } from "../../runtime/data-repo"
import type { WorkflowService } from "../workflow/workflow-service"
import type { ProviderReferenceScannerDeps } from "./provider-reference-scanner"

type ServiceResolver = <T>(id: string) => T

export function createProviderReferenceScannerDeps(
  resolve: ServiceResolver,
): ProviderReferenceScannerDeps {
  return {
    listWorkflowNodes: async () => {
      const workflowService = resolve<WorkflowService>("core.workflow")
      const metas = await workflowService.list()
      const references: Awaited<ReturnType<ProviderReferenceScannerDeps["listWorkflowNodes"]>> = []
      for (const meta of metas) {
        if (meta.loadError) continue
        const definition = await workflowService.get(meta.id) as WorkflowDefinition | null
        if (!definition) continue
        for (const node of definition.nodes) {
          const config = node.config as Record<string, unknown>
          if (typeof config.providerId !== "string" || !config.providerId) continue
          references.push({
            workflowId: definition.id,
            workflowName: definition.name,
            nodeId: node.id,
            nodeName: node.name,
            providerId: config.providerId,
            modelTier: typeof config.modelTier === "string" ? config.modelTier : "default",
          })
        }
        if (definition.defaultProviderId) {
          references.push({
            workflowId: definition.id,
            workflowName: definition.name,
            nodeId: "",
            nodeName: "工作流默认供应商",
            providerId: definition.defaultProviderId,
            modelTier: definition.defaultModelTier ?? "default",
          })
        }
      }
      return references
    },
    updateWorkflowNodeProvider: async (workflowId, nodeId, providerId, modelTier) => {
      const workflowService = resolve<WorkflowService>("core.workflow")
      const definition = await workflowService.get(workflowId) as WorkflowDefinition | null
      if (!definition) throw new Error(`Workflow not found: ${workflowId}`)
      if (!nodeId) {
        await workflowService.save({
          ...definition,
          defaultProviderId: providerId,
          defaultModelTier: modelTier as ModelTier,
        })
        return
      }
      await workflowService.save({
        ...definition,
        nodes: definition.nodes.map((node) => node.id === nodeId
          ? { ...node, config: { ...node.config, providerId, modelTier } }
          : node),
      })
    },
    listConversations: async () => {
      const dataRepository = resolve<DataRepository>("core.data-repository")
      const conversations = await dataRepository.namespace<ConversationEntryV1>("conversations").list()
      return conversations.map((conversation) => ({
        id: conversation.id,
        name: conversation.name ?? conversation.id,
        projectId: conversation.projectId,
        providerId: conversation.providerId,
      }))
    },
    listAgentPersonas: async () => {
      const service = resolve<AgentPersonaService>("core.agent-personas")
      return [...await service.listCached()]
    },
  }
}
