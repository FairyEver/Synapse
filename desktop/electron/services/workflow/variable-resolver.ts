import type { VariableBinding } from "../../../workflow-nodes/schemas/variable-binding"
import { createMainLogger } from "../log-store"

const logger = createMainLogger("service.workflow.variable-resolver")

export interface ResolveVariablesResult {
  resolved: Record<string, string>
  /** Variable names that resolved to empty string because the source node was skipped. */
  skippedReferences: Array<{ variableName: string; sourceNodeId: string; sourceNodeName: string }>
}

/**
 * Resolve variable bindings to concrete string values.
 *
 * When a `node_output` source references a node that was skipped (not in
 * `nodeOutputs` but present in `allNodeIds`), the variable resolves to an
 * empty string instead of throwing. This enables Switch-based merge topologies
 * where a downstream node binds to nodes on multiple branches — only the
 * active branch's node will have output; the others gracefully degrade.
 *
 * If the referenced node doesn't exist in the workflow at all (not in
 * `allNodeIds`), that indicates a broken reference and still throws.
 */
export function resolveVariables(
  bindings: VariableBinding[],
  paramValues: Record<string, unknown>,
  nodeOutputs: Record<string, string>,
  nodeNames?: Record<string, string>,
  allNodeIds?: Set<string>,
): ResolveVariablesResult {
  const resolved: Record<string, string> = {}
  const skippedReferences: ResolveVariablesResult["skippedReferences"] = []

  for (const { name, source } of bindings) {
    if (source.type === "param") {
      if (!(source.param in paramValues)) {
        logger.warn("variable resolved to empty: referenced parameter is missing", {
          variableName: name, paramName: source.param,
        })
      }
      resolved[name] = String(paramValues[source.param] ?? "")
    } else if (source.type === "node_output") {
      if (!(source.node in nodeOutputs)) {
        const displayName = nodeNames?.[source.node] ?? source.node
        // If the node exists in the workflow but has no output, it was skipped
        // by branch logic. Resolve gracefully to empty string.
        if (allNodeIds && allNodeIds.has(source.node)) {
          logger.warn("variable resolved to empty: source node was skipped (branch inactive)", {
            variableName: name, sourceNodeId: source.node, sourceNodeName: displayName,
          })
          resolved[name] = ""
          skippedReferences.push({ variableName: name, sourceNodeId: source.node, sourceNodeName: displayName })
        } else {
          // Node doesn't exist in the workflow — this is a broken reference
          const errorMsg = `变量 $${name} 引用了不存在的节点「${displayName}」`
          logger.error("variable resolution failed: referenced node does not exist", {
            variableName: name, sourceNodeId: source.node, sourceNodeName: displayName,
          })
          throw new Error(errorMsg)
        }
      } else {
        resolved[name] = nodeOutputs[source.node]
      }
    } else {
      resolved[name] = source.value
    }
  }
  return { resolved, skippedReferences }
}


export function interpolatePrompt(template: string, vars: Record<string, string>): string {
  // Supports both {{varName}} and {{$varName}} syntax (design spec uses $-prefix)
  return template.replace(/\{\{\$?([\p{L}\p{N}_]+)\}\}/gu, (match, n) => vars[n] ?? match)
}
