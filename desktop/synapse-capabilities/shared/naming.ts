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
  "extract",
  "extract_to_file",
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
  "pause",
  "resume",
  "remove",
  "rescan",
  "cancel",
  "clear",
  "apply",
  "download_file",
  "ensure",
  "import",
  "materialize",
  "open",
  "preview",
  "republish",
  "resolve",
  "read_text",
  "update_access",
  "update_settings",
  "launch",
  "observe",
  "acquire",
  "renew",
  "release",
  "send",
  "command",
  "paste",
  "raw",
  "force_stop",
  "commit",
  "trigger",
  "submit",
  "repair",
] as const

export type CapabilityAction = typeof CAPABILITY_ACTIONS[number]
export type CapabilityId = `app.${string}.${string}.${CapabilityAction}`
export type IpcOperationId = `app.${string}.${string}.${string}`

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
  if (parts.length < 4 || parts[0] !== "app") return false
  if (!parts.every((part) => TOKEN_PATTERN.test(part))) return false
  return isKnownAction(parts[parts.length - 1])
}

export function assertCanonicalCapabilityId(id: string): asserts id is CapabilityId {
  if (!isCanonicalCapabilityId(id)) {
    throw new Error(`Invalid capability id: ${id}`)
  }
}

export function getCapabilityDomain(id: CapabilityId): string {
  return splitCapabilityId(id)[1]
}

export function getCapabilityAction(id: CapabilityId): CapabilityAction {
  const parts = splitCapabilityId(id)
  return parts[parts.length - 1] as CapabilityAction
}

export function capabilityIdToMcpTool(id: CapabilityId): string {
  return id.replaceAll(".", "_")
}

export function isCanonicalIpcOperationId(id: string): id is IpcOperationId {
  const parts = splitCapabilityId(id)
  return parts.length >= 4 && parts[0] === "app" && parts.every((part) => TOKEN_PATTERN.test(part))
}

export function assertCanonicalIpcOperationId(id: string): asserts id is IpcOperationId {
  if (!isCanonicalIpcOperationId(id)) {
    throw new Error(`Invalid IPC operation id: ${id}`)
  }
}

export function ipcOperationIdToChannel(id: IpcOperationId): string {
  assertCanonicalIpcOperationId(id)
  return `synapse:${id.replaceAll(".", ":")}`
}

export function isCanonicalIpcChannel(channel: string): boolean {
  if (!channel.startsWith("synapse:app:")) return false
  return isCanonicalIpcOperationId(channel.slice("synapse:".length).replaceAll(":", "."))
}

export function assertCanonicalIpcChannel(channel: string): void {
  if (!isCanonicalIpcChannel(channel)) {
    throw new Error(`Invalid IPC channel: ${channel}`)
  }
}

export function capabilityIdToIpcChannel(id: CapabilityId): string {
  assertCanonicalCapabilityId(id)
  return ipcOperationIdToChannel(id)
}

export function ipcOperationIdToBridgePath(id: IpcOperationId): string {
  assertCanonicalIpcOperationId(id)
  return id
    .split(".")
    .slice(1)
    .map((token) => token.replace(/_([a-z0-9])/g, (_match, part: string) => part.toUpperCase()))
    .join(".")
}

export function capabilityIdToServiceMethod(id: CapabilityId): string {
  const pascal = splitCapabilityId(id).map(toPascalToken).join("")
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

export { CAPABILITY_ACTIONS }
