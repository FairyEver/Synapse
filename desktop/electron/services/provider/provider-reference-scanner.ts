import type { ModelTier } from "../../../src/types/provider-model"

export interface ProviderReference {
  kind: "scheduled-task" | "workflow-node" | "conversation"
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
  taskCount: number
  workflowNodeCount: number
  conversationCount: number
}

export interface MigrateProviderReferencesInput {
  sourceProviderId: string
  targetProviderId: string
  targetModelTier: ModelTier
  scope: ("scheduled-task" | "workflow-node")[]
}

export interface MigrateProviderReferencesResult {
  migratedTasks: number
  migratedWorkflowNodes: number
  errors: Array<{ entityId: string; error: string }>
}

export interface TaskActionRef {
  readonly type: string
  readonly config: Record<string, unknown>
}

export interface ProviderReferenceScannerDeps {
  listTasks: () => Promise<Array<{ id: string; name: string; action: TaskActionRef }>>
  updateTaskAction: (id: string, action: TaskActionRef) => Promise<void>
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
}

export class ProviderReferenceScanner {
  constructor(private readonly deps: ProviderReferenceScannerDeps) {}

  async scan(providerId: string): Promise<ProviderReferenceScanResult> {
    const references: ProviderReference[] = []

    const tasks = await this.deps.listTasks()
    for (const task of tasks) {
      const config = task.action.config as Record<string, unknown>
      if (config.providerId === providerId) {
        references.push({
          kind: "scheduled-task",
          entityId: task.id,
          entityName: task.name,
          providerId,
          modelTier: String(config.modelTier ?? "default"),
        })
      }
    }

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

    return {
      providerId,
      references,
      taskCount: references.filter((r) => r.kind === "scheduled-task").length,
      workflowNodeCount: references.filter((r) => r.kind === "workflow-node").length,
      conversationCount: references.filter((r) => r.kind === "conversation").length,
    }
  }

  async migrate(input: MigrateProviderReferencesInput): Promise<MigrateProviderReferencesResult> {
    const errors: Array<{ entityId: string; error: string }> = []
    let migratedTasks = 0
    let migratedWorkflowNodes = 0

    if (input.scope.includes("scheduled-task")) {
      const tasks = await this.deps.listTasks()
      for (const task of tasks) {
        const config = task.action.config as Record<string, unknown>
        if (config.providerId !== input.sourceProviderId) continue
        try {
          const updatedAction: TaskActionRef = {
            type: task.action.type,
            config: { ...config, providerId: input.targetProviderId, modelTier: input.targetModelTier },
          }
          await this.deps.updateTaskAction(task.id, updatedAction)
          migratedTasks++
        } catch (err) {
          errors.push({ entityId: task.id, error: err instanceof Error ? err.message : String(err) })
        }
      }
    }

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

    return { migratedTasks, migratedWorkflowNodes, errors }
  }
}
