import { createHash } from "node:crypto"
import type { WorkflowDefinition } from "../../../src/types/workflow"
import type { WorkflowSharePackageV4 } from "../../../src/types/workflow-package"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import type { WorkflowExportDocumentResult } from "./workflow-service"
import { resolveNodeShareValues } from "./workflow-share-dependency-collector"

export const WORKFLOW_SHARE_MAX_CALL_DEPTH = 5

export interface WorkflowShareGraph {
  readonly entrypoints: string[]
  readonly workflows: WorkflowDefinition[]
  readonly workflowRefs: ReadonlyMap<string, string>
}

export async function collectWorkflowShareGraph(options: {
  readonly entryWorkflowIds: readonly string[]
  readonly loadWorkflow: (id: string) => Promise<WorkflowExportDocumentResult | null>
  readonly maxDepth?: number
}): Promise<WorkflowShareGraph> {
  const maxDepth = options.maxDepth ?? WORKFLOW_SHARE_MAX_CALL_DEPTH
  const workflows = new Map<string, WorkflowDefinition>()
  const workflowRefs = new Map<string, string>()
  const visiting: string[] = []

  const visit = async (workflowId: string, depth: number): Promise<void> => {
    if (depth > maxDepth) {
      throw new Error(`工作流调用深度超过 ${maxDepth} 层。`)
    }
    const cycleStart = visiting.indexOf(workflowId)
    if (cycleStart >= 0) {
      throw new Error(`工作流调用形成循环：${[...visiting.slice(cycleStart), workflowId].join(" → ")}`)
    }
    if (workflows.has(workflowId)) return

    const loaded = await options.loadWorkflow(workflowId)
    if (!loaded) throw new Error(`找不到子工作流 ${workflowId}。`)
    if (loaded.kind === "future") {
      throw new Error(`工作流 ${workflowId} 使用更高的数据版本 ${loaded.sourceVersion}，不能加入分享包。`)
    }
    const workflow = loaded.document
    visiting.push(workflowId)
    workflows.set(workflowId, workflow)
    workflowRefs.set(workflowId, stableWorkflowReference(workflowId))
    for (const childId of workflowChildIds(workflow)) {
      await visit(childId, depth + 1)
    }
    visiting.pop()
  }

  for (const workflowId of options.entryWorkflowIds) {
    await visit(workflowId, 1)
  }

  return {
    entrypoints: options.entryWorkflowIds.map((id) => {
      const ref = workflowRefs.get(id)
      if (!ref) throw new Error(`Missing entrypoint reference for ${id}`)
      return ref
    }),
    workflows: [...workflows.values()],
    workflowRefs,
  }
}

export function workflowChildIds(workflow: WorkflowDefinition): string[] {
  const ids = new Set<string>()
  for (const node of workflow.nodes) {
    const manifest = nodeTypeRegistry.getManifest(node.type)
    for (const declaration of manifest.share.workflows ?? []) {
      for (const located of resolveNodeShareValues(node.config, declaration.path)) {
        if (typeof located.value === "string" && located.value.trim()) ids.add(located.value)
      }
    }
  }
  return [...ids]
}

export function validateWorkflowSharePackageGraph(
  pkg: Pick<WorkflowSharePackageV4, "manifest" | "workflows">,
  maxDepth = WORKFLOW_SHARE_MAX_CALL_DEPTH,
): void {
  const refBySourceId = new Map(pkg.manifest.workflows.map((item) => [item.sourceWorkflowId, item.ref]))
  const childrenByRef = new Map<string, string[]>()
  for (const item of pkg.manifest.workflows) {
    const workflow = pkg.workflows[item.ref]
    if (!workflow) throw new Error(`工作流分享包缺少 ${item.ref}。`)
    const childRefs = workflowChildIds(workflow).map((sourceWorkflowId) => {
      const childRef = refBySourceId.get(sourceWorkflowId)
      if (!childRef) {
        throw new Error(`子工作流 ${sourceWorkflowId} 未包含在分享包中。`)
      }
      return childRef
    })
    childrenByRef.set(item.ref, childRefs)
  }

  const visited = new Set<string>()
  const visiting: string[] = []
  const visit = (ref: string, depth: number): void => {
    if (depth > maxDepth) throw new Error(`工作流调用深度超过 ${maxDepth} 层。`)
    const cycleStart = visiting.indexOf(ref)
    if (cycleStart >= 0) {
      throw new Error(`工作流调用形成循环：${[...visiting.slice(cycleStart), ref].join(" → ")}`)
    }
    if (visited.has(ref)) return
    visiting.push(ref)
    for (const childRef of childrenByRef.get(ref) ?? []) visit(childRef, depth + 1)
    visiting.pop()
    visited.add(ref)
  }
  for (const entrypoint of pkg.manifest.entrypoints) visit(entrypoint, 1)
  if (visited.size !== pkg.manifest.workflows.length) {
    throw new Error("工作流分享包包含入口无法到达的工作流。")
  }
}

export function stableWorkflowReference(sourceWorkflowId: string): string {
  const digest = createHash("sha256").update(`workflow\u0000${sourceWorkflowId}`).digest("hex").slice(0, 20)
  return `workflow_${digest}`
}
