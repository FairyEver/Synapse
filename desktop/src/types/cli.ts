export type SynapseCliId = string & { readonly __brand?: "SynapseCliId" }

export type SynapseCliDetectResult = {
  id: SynapseCliId
  label: string
  installed: boolean
  path: string | null
}
