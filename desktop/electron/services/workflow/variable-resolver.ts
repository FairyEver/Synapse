import type { VariableBinding } from "../../../workflow-nodes/schemas/variable-binding"

export function resolveVariables(
  bindings: VariableBinding[],
  paramValues: Record<string, unknown>,
  nodeOutputs: Record<string, string>,
  nodeNames?: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const { name, source } of bindings) {
    if (source.type === "param") {
      result[name] = String(paramValues[source.param] ?? "")
    } else if (source.type === "node_output") {
      if (!(source.node in nodeOutputs)) {
        const displayName = nodeNames?.[source.node] ?? source.node
        throw new Error(`变量 $${name} 引用的节点「${displayName}」在本次运行中未执行（被分支跳过）`)
      }
      result[name] = nodeOutputs[source.node]
    } else {
      result[name] = source.value
    }
  }
  return result
}

export function interpolatePrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z0-9_\u4e00-\u9fff]+)\}\}/g, (_, n) => vars[n] ?? `{{${n}}}`)
}
