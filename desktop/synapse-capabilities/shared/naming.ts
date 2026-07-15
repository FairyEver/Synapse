const CAPABILITY_ACTIONS = [
  "list",
  "get",
  "create",
  "update",
  "update_local",
  "upsert",
  "delete",
  "count",
  "rename",
  "describe",
  "inspect",
  "enable",
  "disable",
  "read",
  "write",
  "resize",
  "execute",
  "reorder",
  "move",
  "import_local",
  "upload",
  "restore",
  "generate",
  "play",
  "start",
  "stop",
  "stop_refill",
  "cancel",
  "open",
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

export function legacyToolNameForPrimary(
  primaryName: string,
  legacyPrefix: string,
  primaryPrefix: string,
): string {
  if (!primaryName.startsWith(`${primaryPrefix}_`)) {
    throw new Error(`Primary tool ${primaryName} does not start with ${primaryPrefix}_`)
  }
  return `${legacyPrefix}_${primaryName.slice(primaryPrefix.length + 1)}`
}

export function primaryToolNameForLegacy(
  legacyName: string,
  legacyPrefix: string,
  primaryPrefix: string,
): string {
  if (!legacyName.startsWith(`${legacyPrefix}_`)) {
    throw new Error(`Legacy tool ${legacyName} does not start with ${legacyPrefix}_`)
  }
  return `${primaryPrefix}_${legacyName.slice(legacyPrefix.length + 1)}`
}

export function capabilityIdToServiceMethod(id: CapabilityId): string {
  const pascal = splitCapabilityId(id).map(toPascalToken).join("")
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

export { CAPABILITY_ACTIONS }
