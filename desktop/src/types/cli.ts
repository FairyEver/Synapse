export const SYNAPSE_CLI_IDS = ["claude-code", "codex"] as const

export type SynapseCliId = (typeof SYNAPSE_CLI_IDS)[number]

export type SynapseCliDetectResult = {
  id: SynapseCliId
  label: string
  installed: boolean
  path: string | null
}
