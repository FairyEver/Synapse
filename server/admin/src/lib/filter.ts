export function includesSearch(value: string | null | undefined, search: string): boolean {
  const normalizedSearch = search.trim().toLowerCase()
  if (!normalizedSearch) return true
  return (value ?? "").toLowerCase().includes(normalizedSearch)
}
