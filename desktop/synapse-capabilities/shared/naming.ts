const CAPABILITY_ACTIONS = [
  "list",
  "get",
  "create",
  "update",
  "upsert",
  "delete",
  "count",
  "rename",
  "describe",
  "inspect",
  "enable",
  "disable",
  "read",
  "execute",
  "reorder",
  "move",
  "upload",
  "restore",
  "generate",
] as const

export type CapabilityAction = typeof CAPABILITY_ACTIONS[number]
export type CapabilityId = `${string}.${string}.${CapabilityAction}`

const TOKEN_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/

function splitCapabilityId(id: string): string[] {
  return id.split(".")
}

function isKnownAction(action: string): action is CapabilityAction {
  return CAPABILITY_ACTIONS.includes(action as CapabilityAction)
}

function toPascalToken(token: string): string {
  return token
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
}

export function isCanonicalCapabilityId(id: string): id is CapabilityId {
  const parts = splitCapabilityId(id)
  if (parts.length < 3) return false
  if (!parts.every((part) => TOKEN_PATTERN.test(part))) return false
  return isKnownAction(parts[parts.length - 1])
}

export function assertCanonicalCapabilityId(id: string): asserts id is CapabilityId {
  if (!isCanonicalCapabilityId(id)) {
    throw new Error(`Invalid capability id: ${id}`)
  }
}

export function getCapabilityDomain(id: CapabilityId): string {
  return splitCapabilityId(id)[0]
}

export function getCapabilityAction(id: CapabilityId): CapabilityAction {
  const parts = splitCapabilityId(id)
  return parts[parts.length - 1] as CapabilityAction
}

export function capabilityIdToMcpTool(id: CapabilityId): string {
  return id.replaceAll(".", "_")
}

export function capabilityIdToServiceMethod(id: CapabilityId): string {
  const pascal = splitCapabilityId(id).map(toPascalToken).join("")
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

export { CAPABILITY_ACTIONS }
