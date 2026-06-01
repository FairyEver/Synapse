import type { ModulePermissionDefinition } from '@/lib/api'

export function togglePermissionKey(
  values: ReadonlySet<string>,
  key: string,
  checked: boolean
): Set<string> {
  const next = new Set(values)
  if (checked) {
    next.add(key)
  } else {
    next.delete(key)
  }
  return next
}

export function formatModulePermissionSummary(
  permissionKeys: readonly string[],
  definitions: readonly ModulePermissionDefinition[]
): string {
  if (permissionKeys.length === 0) return '-'

  const definitionsByKey = new Map(
    definitions.map((definition) => [definition.key, definition])
  )

  return [...permissionKeys]
    .sort((left, right) => {
      const leftOrder = definitionsByKey.get(left)?.sortOrder ?? Number.MAX_SAFE_INTEGER
      const rightOrder = definitionsByKey.get(right)?.sortOrder ?? Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder || left.localeCompare(right)
    })
    .map((key) => definitionsByKey.get(key)?.label ?? key)
    .join('、')
}
