function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object") return false
  if (a === null || b === null) return false

  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)

  if (aKeys.length !== bKeys.length) return false

  for (const key of aKeys) {
    if (!bKeys.includes(key)) return false
    if (!isDeepEqual(aObj[key], bObj[key])) return false
  }

  return true
}

export { isDeepEqual }
