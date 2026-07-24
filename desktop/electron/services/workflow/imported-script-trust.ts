import type { WorkflowDefinition } from "../../../src/types/workflow"
import {
  JAVASCRIPT_RUN_WORKFLOW_NODE_TYPE,
  NODEJS_RUN_WORKFLOW_NODE_TYPE,
} from "../../../app-capabilities/script-runtime/shared/capability"
import { computeFullExecutionSet } from "./workflow-utils"

export type ImportedScriptPreview = {
  readonly workflowId: string
  readonly workflowName: string
  readonly nodeId: string
  readonly nodeName: string
  readonly runtime: "JavaScript" | "Node.js"
  readonly source: string
}

export type ImportedScriptReview = {
  readonly definitions: readonly WorkflowDefinition[]
  readonly snapshotDefinitions: readonly WorkflowDefinition[]
  readonly scripts: readonly ImportedScriptPreview[]
  readonly reachableRevisions: readonly {
    readonly workflowId: string
    readonly revision: string
  }[]
}

export async function collectUnconfirmedImportedScripts(options: {
  readonly entry: WorkflowDefinition
  readonly loadWorkflow: (id: string) => Promise<WorkflowDefinition | null>
}): Promise<ImportedScriptReview> {
  const visited = new Set<string>()
  const definitions: WorkflowDefinition[] = []
  const snapshotDefinitions: WorkflowDefinition[] = []
  const scripts: ImportedScriptPreview[] = []
  const reachableRevisions: Array<{ workflowId: string; revision: string }> = []

  const visit = async (definition: WorkflowDefinition): Promise<void> => {
    if (visited.has(definition.id)) return
    visited.add(definition.id)
    snapshotDefinitions.push(definition)
    reachableRevisions.push({
      workflowId: definition.id,
      revision: definition.version,
    })
    const { executableNodeIds } = computeFullExecutionSet(definition)
    if (definition.scriptTrust?.source === "imported" && !definition.scriptTrust.confirmed) {
      const workflowScripts = definition.nodes
        .filter((node) =>
          executableNodeIds.has(node.id)
          && (
            node.type === JAVASCRIPT_RUN_WORKFLOW_NODE_TYPE
            || node.type === NODEJS_RUN_WORKFLOW_NODE_TYPE
          ))
        .map((node): ImportedScriptPreview => ({
          workflowId: definition.id,
          workflowName: definition.name,
          nodeId: node.id,
          nodeName: node.name,
          runtime: node.type === NODEJS_RUN_WORKFLOW_NODE_TYPE ? "Node.js" : "JavaScript",
          source: typeof node.config.source === "string" ? node.config.source : "",
        }))
      if (workflowScripts.length > 0) {
        definitions.push(definition)
        scripts.push(...workflowScripts)
      }
    }
    const childIds = definition.nodes.flatMap((node) => (
      executableNodeIds.has(node.id)
      && node.type === "workflow_call"
      && typeof node.config.workflowId === "string"
      && node.config.workflowId
        ? [node.config.workflowId]
        : []
    ))
    for (const childId of childIds) {
      const child = await options.loadWorkflow(childId)
      if (child) await visit(child)
    }
  }

  await visit(options.entry)
  return {
    definitions: definitions.sort((left, right) => left.id.localeCompare(right.id)),
    snapshotDefinitions: snapshotDefinitions.sort((left, right) => left.id.localeCompare(right.id)),
    scripts: scripts.sort((left, right) => (
      left.workflowId.localeCompare(right.workflowId)
      || left.nodeId.localeCompare(right.nodeId)
    )),
    reachableRevisions: reachableRevisions.sort((left, right) =>
      left.workflowId.localeCompare(right.workflowId)),
  }
}
