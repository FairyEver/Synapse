import { z } from "zod"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { ConnectorRegistryService, ConnectorDraftInput } from "../../services/connector-registry-service"
import type { ConnectorQrOnboardingService } from "../../services/connector-qr-onboarding-service"
import { normalizeInboundMessage } from "../../services/inbound-message-normalizer"

const connectorOptionDefinitionSchema = z.object({
  name: z.string(),
  kind: z.enum(["string", "boolean", "number", "secret"]),
  required: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.boolean(), z.number()]).optional(),
})

const connectorDescriptorSchema = z.object({
  type: z.string(),
  label: z.string(),
  transport: z.string(),
  options: z.array(connectorOptionDefinitionSchema),
  capabilities: z.array(z.string()),
})

const connectorEntrySchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  type: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  status: z.enum(["configured", "disabled", "invalid"]),
  options: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])),
  secretRefs: z.record(z.string(), z.string()),
  capabilities: z.array(z.string()),
  allowFrom: z.string().optional(),
})

const connectorDraftSchema = z.object({
  connector: connectorEntrySchema,
  secrets: z.array(z.object({
    id: z.string(),
    kind: z.literal("generic"),
    description: z.string(),
    value: z.string(),
  })),
  issues: z.array(z.object({
    code: z.enum(["missing_required_option", "unknown_connector_type"]),
    option: z.string().optional(),
    message: z.string(),
  })),
  warnings: z.array(z.string()),
})

const draftInputSchema = z.object({
  type: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  secretRefs: z.record(z.string(), z.string()).optional(),
})

const qrPlatformSchema = z.enum(["feishu", "lark", "weixin"])

const qrSessionSchema = z.object({
  sessionId: z.string(),
  platform: qrPlatformSchema,
  status: z.enum(["waiting", "scanned", "success", "expired", "denied", "cancelled", "failed"]),
  qrContent: z.string().nullable(),
  intervalSeconds: z.number(),
  expiresAt: z.string().nullable(),
  refreshCount: z.number(),
  result: z.record(z.string(), z.string()).nullable(),
  error: z.string().nullable(),
})

const platformConnectionSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  status: z.enum(["draft", "configured", "disabled", "invalid"]),
  enabled: z.boolean(),
  options: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).optional(),
  secretRefs: z.record(z.string(), z.string()).optional(),
  allowFrom: z.string().optional(),
  shareSessionInChannel: z.boolean().optional(),
  groupReplyAll: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const qrBeginRequestSchema = z.object({
  platform: qrPlatformSchema,
})

const qrSessionRequestSchema = z.object({
  sessionId: z.string(),
})

const qrSaveRequestSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
})

const manualPlatformSaveRequestSchema = z.object({
  projectId: z.string(),
  type: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
})

const platformSaveResponseSchema = z.object({
  connection: platformConnectionSchema,
})

type QrBeginRequest = z.infer<typeof qrBeginRequestSchema>
type QrSessionRequest = z.infer<typeof qrSessionRequestSchema>
type QrSaveRequest = z.infer<typeof qrSaveRequestSchema>
type ManualPlatformSaveRequest = z.infer<typeof manualPlatformSaveRequestSchema>

const inboundNormalizeRequestSchema = z.object({
  raw: z.unknown(),
  connectorId: z.string().optional(),
  platform: z.string().optional(),
  allowFrom: z.string().optional(),
  shareSessionInChannel: z.boolean().optional(),
  threadIsolation: z.boolean().optional(),
})

type InboundNormalizeRequest = z.infer<typeof inboundNormalizeRequestSchema>

const inboundAttachmentSchema = z.object({
  kind: z.enum(["image", "file", "audio"]),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number().optional(),
  ref: z.string().optional(),
  url: z.string().optional(),
  hasInlineData: z.boolean().optional(),
})

const inboundDiagnosticSchema = z.object({
  rawKeys: z.array(z.string()),
  attachmentCount: z.number(),
  savedRaw: z.boolean(),
})

const inboundResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    message: z.object({
      connectorId: z.string().optional(),
      platform: z.string(),
      sessionKey: z.string(),
      channelKey: z.string(),
      messageId: z.string().optional(),
      userId: z.string(),
      userName: z.string().optional(),
      chatName: z.string().optional(),
      content: z.string(),
      attachments: z.array(inboundAttachmentSchema),
      location: z.object({
        latitude: z.number(),
        longitude: z.number(),
        label: z.string().optional(),
      }).optional(),
      extraContent: z.string().optional(),
      replyContext: z.unknown().optional(),
      fromVoice: z.boolean(),
      modeOverride: z.string().optional(),
      authorized: z.boolean(),
      receivedAt: z.string(),
    }),
    diagnostic: inboundDiagnosticSchema,
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(["invalid_payload", "missing_field", "empty_message", "unauthorized"]),
    message: z.string(),
    diagnostic: inboundDiagnosticSchema,
  }),
])

function connectorsService(ctx: IpcHandlerContext): ConnectorRegistryService {
  return ctx.resolve<ConnectorRegistryService>("connectors.registry")
}

function qrOnboardingService(ctx: IpcHandlerContext): ConnectorQrOnboardingService {
  return ctx.resolve<ConnectorQrOnboardingService>("connectors.qr-onboarding")
}

export const connectorsIpcModule: IpcModule = {
  id: "connectors",
  methods: {
    listDescriptors: {
      kind: "invoke",
      channel: "synapse:connectors:list-descriptors",
      request: z.void(),
      response: z.array(connectorDescriptorSchema),
      handler: (ctx) => connectorsService(ctx).listDescriptors(),
    },
    createDraft: {
      kind: "invoke",
      channel: "synapse:connectors:create-draft",
      request: draftInputSchema,
      response: connectorDraftSchema,
      handler: (ctx, input: ConnectorDraftInput) => connectorsService(ctx).createConnectorDraft(input),
    },
    beginQr: {
      kind: "invoke",
      channel: "synapse:connectors:begin-qr",
      request: qrBeginRequestSchema,
      response: qrSessionSchema,
      handler: (ctx, input: QrBeginRequest) => qrOnboardingService(ctx).beginQr(input.platform),
    },
    pollQr: {
      kind: "invoke",
      channel: "synapse:connectors:poll-qr",
      request: qrSessionRequestSchema,
      response: qrSessionSchema,
      handler: (ctx, input: QrSessionRequest) => qrOnboardingService(ctx).pollQr(input.sessionId),
    },
    cancelQr: {
      kind: "invoke",
      channel: "synapse:connectors:cancel-qr",
      request: qrSessionRequestSchema,
      response: qrSessionSchema,
      handler: (ctx, input: QrSessionRequest) => qrOnboardingService(ctx).cancelQr(input.sessionId),
    },
    saveQr: {
      kind: "invoke",
      channel: "synapse:connectors:save-qr",
      request: qrSaveRequestSchema,
      response: platformSaveResponseSchema,
      handler: (ctx, input: QrSaveRequest) => qrOnboardingService(ctx).saveCompletedQr(input),
    },
    saveManualPlatform: {
      kind: "invoke",
      channel: "synapse:connectors:save-manual-platform",
      request: manualPlatformSaveRequestSchema,
      response: platformSaveResponseSchema,
      handler: (ctx, input: ManualPlatformSaveRequest) => qrOnboardingService(ctx).saveManualPlatform(input),
    },
    normalizeInbound: {
      kind: "invoke",
      channel: "synapse:connectors:normalize-inbound",
      request: inboundNormalizeRequestSchema,
      response: inboundResultSchema,
      handler: (_ctx, input: InboundNormalizeRequest) => normalizeInboundMessage(input.raw, {
        connectorId: input.connectorId,
        platform: input.platform,
        allowFrom: input.allowFrom,
        shareSessionInChannel: input.shareSessionInChannel,
        threadIsolation: input.threadIsolation,
      }),
    },
  },
  events: {},
}
