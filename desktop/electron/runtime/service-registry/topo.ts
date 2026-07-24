/**
 * Phase 0.1 — Topological sort for ServiceDescriptor dependency graphs.
 * SPEC §4.
 *
 * Uses Kahn's algorithm so we can preserve a deterministic node iteration order
 * (registration order, with stable tie-breaking). On detecting a cycle we walk
 * the residual graph with DFS to extract one concrete cycle for diagnostics.
 */

import {
  CircularDependencyError,
  UnknownDependencyError,
} from "./errors"
import type { ServiceDescriptor } from "./types"

export interface TopoNode {
  readonly id: string
  readonly dependsOn: readonly string[]
}

/**
 * Returns nodes in start order (deps before dependents).
 * Throws UnknownDependencyError if any ordering edge targets an unregistered service.
 * Throws CircularDependencyError with the offending cycle path if a cycle exists.
 */
export function topoSort<T extends TopoNode>(nodes: readonly T[]): T[] {
  const byId = new Map<string, T>()
  for (const node of nodes) {
    byId.set(node.id, node)
  }

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!byId.has(dep)) {
        throw new UnknownDependencyError(node.id, dep)
      }
    }
  }

  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const node of nodes) {
    inDegree.set(node.id, node.dependsOn.length)
    if (!dependents.has(node.id)) dependents.set(node.id, [])
  }
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      const list = dependents.get(dep)
      if (list) list.push(node.id)
    }
  }

  const ready: string[] = []
  for (const node of nodes) {
    if ((inDegree.get(node.id) ?? 0) === 0) {
      ready.push(node.id)
    }
  }

  const order: T[] = []
  while (ready.length > 0) {
    const id = ready.shift()!
    const node = byId.get(id)
    if (!node) continue
    order.push(node)
    for (const child of dependents.get(id) ?? []) {
      const next = (inDegree.get(child) ?? 0) - 1
      inDegree.set(child, next)
      if (next === 0) ready.push(child)
    }
  }

  if (order.length !== nodes.length) {
    const remaining = nodes.filter((n) => order.find((o) => o.id === n.id) === undefined)
    const cycle = findCycle(remaining)
    throw new CircularDependencyError(cycle)
  }

  return order
}

/** Reverse of `topoSort` — useful for stop ordering. */
export function reverseTopoSort<T extends TopoNode>(nodes: readonly T[]): T[] {
  return [...topoSort(nodes)].reverse()
}

/**
 * DFS over the residual subgraph to surface one concrete cycle path.
 * Falls back to listing remaining ids if no closed cycle is reachable from
 * any single node (which Kahn's already proved cannot happen, but stay safe).
 */
function findCycle<T extends TopoNode>(remaining: readonly T[]): string[] {
  const set = new Set(remaining.map((n) => n.id))
  const byId = new Map(remaining.map((n) => [n.id, n] as const))

  const stack: string[] = []
  const onStack = new Set<string>()
  const visited = new Set<string>()

  function dfs(id: string): string[] | null {
    if (onStack.has(id)) {
      const startIdx = stack.indexOf(id)
      return [...stack.slice(startIdx), id]
    }
    if (visited.has(id)) return null
    visited.add(id)
    onStack.add(id)
    stack.push(id)

    const node = byId.get(id)
    if (node) {
      for (const dep of node.dependsOn) {
        if (!set.has(dep)) continue
        const found = dfs(dep)
        if (found) return found
      }
    }

    stack.pop()
    onStack.delete(id)
    return null
  }

  for (const node of remaining) {
    const cycle = dfs(node.id)
    if (cycle) return cycle
  }

  return remaining.map((n) => n.id)
}

/** Helper for ServiceDescriptor to TopoNode adapter. */
export function descriptorAsNode<T>(d: ServiceDescriptor<T>): TopoNode {
  return {
    id: d.id,
    dependsOn: [...new Set([...(d.dependsOn ?? []), ...(d.startAfter ?? [])])],
  }
}
