import { useMemo } from "react"
import type { WorkflowDefinition } from "@/types/workflow"

export function useUpstreamNodes(nodeId: string, definition: WorkflowDefinition | null) {
  return useMemo(() => {
    if (!definition) return []
    const rev = new Map(definition.nodes.map((n) => [n.id, [] as string[]]))
    for (const e of definition.edges) rev.get(e.to)?.push(e.from)
    const visited = new Set<string>(); const stack = [nodeId]
    while (stack.length) { for (const p of rev.get(stack.pop()!) ?? []) { if (!visited.has(p)) { visited.add(p); stack.push(p) } } }
    return definition.nodes.filter((n) => visited.has(n.id)).map((n) => ({ id: n.id, name: n.name }))
  }, [nodeId, definition])
}
