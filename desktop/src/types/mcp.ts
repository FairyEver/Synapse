type McpTarget = string & { readonly __brand?: "McpTarget" }

type McpRegistrationInfo = {
  target: McpTarget
  settingsPath: string
  settingsFileExists: boolean
  registered: boolean
  mode: "http" | "stdio" | null
  url: string | null
  readError?: string
}

type McpServerStatus = {
  running: boolean
  port: number
  url: string
}

export type {
  McpRegistrationInfo,
  McpServerStatus,
  McpTarget,
}
