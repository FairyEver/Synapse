import type { WorkflowEdge } from "@/types/workflow"

type BranchLike = { id: string }

interface SyncSwitchBranchReferencesInput {
  nodeId: string
  previousConfig: Record<string, unknown>
  nextConfig: Record<string, unknown>
  edges: readonly WorkflowEdge[]
}

interface SyncSwitchBranchReferencesResult {
  config: Record<string, unknown>
  edges: WorkflowEdge[]
  orphanedEdgeIds: string[]
}

export function syncSwitchBranchReferences(input: SyncSwitchBranchReferencesInput): SyncSwitchBranchReferencesResult {
  const previousBranches = readBranches(input.previousConfig)
  const nextBranches = readBranches(input.nextConfig)
  const branchRenames = resolveBranchRenames(previousBranches, nextBranches)
  const nextBranchIds = new Set(nextBranches.map((branch) => branch.id))
  const nextConfig = syncDefaultBranch(input.nextConfig, branchRenames)
  const renamedEdges = input.edges.map((edge) => {
    if (edge.from !== input.nodeId || !edge.branch) return edge
    const renamedBranch = branchRenames.get(edge.branch)
    return renamedBranch ? { ...edge, branch: renamedBranch } : edge
  })
  const orphanedEdgeIds = renamedEdges
    .filter((edge) => edge.from === input.nodeId && edge.branch && !nextBranchIds.has(edge.branch))
    .map((edge) => edge.id)
  const orphanedEdgeIdSet = new Set(orphanedEdgeIds)

  return {
    config: nextConfig,
    edges: renamedEdges.filter((edge) => !orphanedEdgeIdSet.has(edge.id)),
    orphanedEdgeIds,
  }
}

function readBranches(config: Record<string, unknown>): BranchLike[] {
  const branches = config.branches
  if (!Array.isArray(branches)) return []
  return branches
    .map((branch) => {
      if (!branch || typeof branch !== "object") return null
      const id = (branch as { id?: unknown }).id
      return typeof id === "string" ? { id } : null
    })
    .filter((branch): branch is BranchLike => branch !== null)
}

function resolveBranchRenames(previousBranches: readonly BranchLike[], nextBranches: readonly BranchLike[]): Map<string, string> {
  const renames = new Map<string, string>()
  if (previousBranches.length !== nextBranches.length) return renames

  const previousIds = new Set(previousBranches.map((branch) => branch.id))
  const nextIds = new Set(nextBranches.map((branch) => branch.id))
  for (let index = 0; index < previousBranches.length; index++) {
    const previousId = previousBranches[index]?.id
    const nextId = nextBranches[index]?.id
    if (!previousId || !nextId || previousId === nextId) continue
    if (nextIds.has(previousId) || previousIds.has(nextId)) continue
    renames.set(previousId, nextId)
  }
  return renames
}

function syncDefaultBranch(config: Record<string, unknown>, branchRenames: ReadonlyMap<string, string>): Record<string, unknown> {
  const defaultBranch = config.defaultBranch
  if (typeof defaultBranch !== "string") return config
  const renamedDefaultBranch = branchRenames.get(defaultBranch)
  return renamedDefaultBranch ? { ...config, defaultBranch: renamedDefaultBranch } : config
}
