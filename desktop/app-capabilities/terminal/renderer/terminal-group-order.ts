import type { SynapseTerminalGroupSummary } from "../../../src/types/terminal"

type TerminalGroupMoveDirection = "up" | "down"

function moveGroupId(
  groupIds: readonly string[],
  groupId: string,
  direction: TerminalGroupMoveDirection,
): string[] | null {
  const currentIndex = groupIds.indexOf(groupId)
  if (currentIndex < 0) return null

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1
  if (targetIndex < 0 || targetIndex >= groupIds.length) return null

  const next = [...groupIds]
  const [moved] = next.splice(currentIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
}

function applyGroupOrder(
  groups: readonly SynapseTerminalGroupSummary[],
  groupIds: readonly string[],
): SynapseTerminalGroupSummary[] {
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const ordered: SynapseTerminalGroupSummary[] = []
  const placed = new Set<string>()

  for (const groupId of groupIds) {
    const group = groupById.get(groupId)
    if (!group || placed.has(groupId)) continue
    placed.add(groupId)
    ordered.push({ ...group, sortOrder: ordered.length })
  }

  for (const group of groups) {
    if (placed.has(group.id)) continue
    placed.add(group.id)
    ordered.push({ ...group, sortOrder: ordered.length })
  }

  return ordered
}

export {
  applyGroupOrder,
  moveGroupId,
  type TerminalGroupMoveDirection,
}
