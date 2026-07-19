import type { ModelTier } from "../../../src/types/provider-model"

export interface ProviderReference {
  kind: "workflow-node" | "conversation" | "agent-persona"
  entityId: string
  entityName: string
  nodeId?: string
  nodeName?: string
  providerId: string
  modelTier: string
}

export interface ProviderReferenceScanResult {
  providerId: string
  references: ProviderReference[]
  workflowNodeCount: number
  conversationCount: number
  agentPersonaCount: number
}

export interface MigrateProviderReferencesInput {
  sourceProviderId: string
  targetProviderId: string
  targetModelTier: ModelTier
  scope: "workflow-node"[]
}

export interface MigrateProviderReferencesResult {
  migratedWorkflowNodes: number
  errors: Array<{ entityId: string; error: string }>
}

export interface ProviderReferenceScannerDeps {
  listWorkflowNodes: () => Promise<Array<{
    workflowId: string; workflowName: string
    nodeId: string; nodeName: string
    providerId: string; modelTier: string
  }>>
  updateWorkflowNodeProvider: (
    workflowId: string, nodeId: string,
    providerId: string, modelTier: string,
  ) => Promise<void>
  listConversations: () => Promise<Array<{ id: string; name: string; providerId?: string }>>
  listAgentPersonas: () => Promise<Array<{
    id: string
    name: string
    providerModel: { providerId: string; modelTier: string } | null
  }>>
}

export class ProviderReferenceScanner {
  constructor(private readonly deps: ProviderReferenceScannerDeps) {}

  async scan(providerId: string): Promise<ProviderReferenceScanResult> {
    const references: ProviderReference[] = []

    const nodes = await this.deps.listWorkflowNodes()
    for (const node of nodes) {
      if (node.providerId === providerId) {
        references.push({
          kind: "workflow-node",
          entityId: node.workflowId,
          entityName: node.workflowName,
          nodeId: node.nodeId,
          nodeName: node.nodeName,
          providerId,
          modelTier: node.modelTier,
        })
      }
    }

    const conversations = await this.deps.listConversations()
    for (const conv of conversations) {
      if (conv.providerId === providerId) {
        references.push({
          kind: "conversation",
          entityId: conv.id,
          entityName: conv.name,
          providerId,
          modelTier: "",
        })
      }
    }

    const agentPersonas = await this.deps.listAgentPersonas()
    for (const persona of agentPersonas) {
      if (persona.providerModel?.providerId === providerId) {
        references.push({
          kind: "agent-persona",
          entityId: persona.id,
          entityName: persona.name,
          providerId,
          modelTier: persona.providerModel.modelTier,
        })
      }
    }

    return {
      providerId,
      references,
      workflowNodeCount: references.filter((r) => r.kind === "workflow-node").length,
      conversationCount: references.filter((r) => r.kind === "conversation").length,
      agentPersonaCount: references.filter((r) => r.kind === "agent-persona").length,
    }
  }

  async migrate(input: MigrateProviderReferencesInput): Promise<MigrateProviderReferencesResult> {
    const errors: Array<{ entityId: string; error: string }> = []
    let migratedWorkflowNodes = 0

    if (input.scope.includes("workflow-node")) {
      const nodes = await this.deps.listWorkflowNodes()
      for (const node of nodes) {
        if (node.providerId !== input.sourceProviderId) continue
        try {
          await this.deps.updateWorkflowNodeProvider(
            node.workflowId, node.nodeId,
            input.targetProviderId, input.targetModelTier,
          )
          migratedWorkflowNodes++
        } catch (err) {
          errors.push({ entityId: `${node.workflowId}:${node.nodeId}`, error: err instanceof Error ? err.message : String(err) })
        }
      }
    }

    return { migratedWorkflowNodes, errors }
  }
}
