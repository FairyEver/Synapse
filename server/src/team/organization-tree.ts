export function descendantIds(organizations: readonly { id: string; parentId: string | null }[], rootId: string): string[] {
  const children = new Map<string, string[]>()
  for (const organization of organizations) {
    if (!organization.parentId) continue
    const siblings = children.get(organization.parentId) ?? []
    siblings.push(organization.id)
    children.set(organization.parentId, siblings)
  }
  const result: string[] = []
  const pending = [rootId]
  const seen = new Set<string>()
  while (pending.length) {
    const id = pending.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
    pending.push(...(children.get(id) ?? []))
  }
  return result
}
