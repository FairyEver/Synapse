export const isInternalMcp = (name: string): boolean => name === "synapse-mcp" || name === "synapse-tool-router"

export const isValidMcpName = (name: string): boolean => name.length > 0 && name.length <= 256
  && name === name.trim() && !/[\x00-\x1f\x7f]/u.test(name)

export function normalizeDisabledMcpServers(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === "string" && isValidMcpName(v) && !isInternalMcp(v)))].sort()
    : []
}
