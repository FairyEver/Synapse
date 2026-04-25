export type SynapseConnectorOptionKind = "string" | "boolean" | "number" | "secret"

export type SynapseConnectorOptionDefinition = {
  name: string
  kind: SynapseConnectorOptionKind
  required?: boolean
  defaultValue?: string | boolean | number
}

export type SynapseConnectorStatus = "configured" | "disabled" | "invalid"

export type SynapseConnectorDescriptor = {
  type: string
  label: string
  transport: string
  options: SynapseConnectorOptionDefinition[]
  capabilities: string[]
}

export type SynapseConnectorEntry = {
  id: string
  schemaVersion: 1
  type: string
  name: string
  enabled: boolean
  status: SynapseConnectorStatus
  options: Record<string, string | boolean | number>
  secretRefs: Record<string, string>
  capabilities: string[]
  allowFrom?: string
}

export type SynapseConnectorSecretDraft = {
  id: string
  kind: "generic"
  description: string
  value: string
}

export type SynapseConnectorIssue = {
  code: "missing_required_option" | "unknown_connector_type"
  option?: string
  message: string
}

export type SynapseConnectorDraft = {
  connector: SynapseConnectorEntry
  secrets: SynapseConnectorSecretDraft[]
  issues: SynapseConnectorIssue[]
  warnings: string[]
}

export type SynapseInboundAttachmentKind = "image" | "file" | "audio"

export type SynapseInboundAttachment = {
  kind: SynapseInboundAttachmentKind
  name?: string
  mimeType?: string
  size?: number
  ref?: string
  url?: string
  hasInlineData?: boolean
}

export type SynapseInboundLocation = {
  latitude: number
  longitude: number
  label?: string
}

export type SynapseInboundMessage = {
  connectorId?: string
  platform: string
  sessionKey: string
  channelKey: string
  messageId?: string
  userId: string
  userName?: string
  chatName?: string
  content: string
  attachments: SynapseInboundAttachment[]
  location?: SynapseInboundLocation
  extraContent?: string
  replyContext?: unknown
  fromVoice: boolean
  modeOverride?: string
  authorized: boolean
  receivedAt: string
}

export type SynapseInboundDiagnostic = {
  rawKeys: string[]
  attachmentCount: number
  savedRaw: boolean
}

export type SynapseInboundNormalizationErrorCode =
  | "invalid_payload"
  | "missing_field"
  | "empty_message"
  | "unauthorized"

export type SynapseInboundNormalizationResult =
  | {
      ok: true
      message: SynapseInboundMessage
      diagnostic: SynapseInboundDiagnostic
    }
  | {
      ok: false
      code: SynapseInboundNormalizationErrorCode
      message: string
      diagnostic: SynapseInboundDiagnostic
    }
