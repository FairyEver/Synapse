import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

import { BrowserWindow, dialog, shell } from "electron"
import type { OpenDialogOptions } from "electron"
import { z } from "zod"

import type {
  IpcHandlerContext,
  IpcInvocationSender,
  IpcMethodDescriptor,
} from "../../runtime/ipc/types"
import { projectRequestSchema } from "../../runtime/ipc/schemas"
import type { DataRepository } from "../../runtime/data-repo"
import { quoteWindowsCommandArg } from "../../runtime/process/controlled-runner"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import {
  AGENT_REFERENCE_ACTION_SERVICE_ID,
  type AgentReferenceActionKind,
  type AgentReferenceActionService,
} from "../../services/agent-reference-action-service"
import {
  AGENT_REFERENCE_ACTION_ERROR_CODES,
  AGENT_REFERENCE_MAX_CODE_POINTS,
  type AgentReferenceActionResult,
} from "../../../src/types/agent-reference-action"
import { resolveLocalReference } from "../../services/agent-runtime/references"
import type {
  CCProvider,
  CcSwitchImportSource,
  CreateProviderFromPresetInput,
  CreateProviderInput,
  ImportCcSwitchClaudeProvidersInput,
  ProviderApiKeyField,
  ProviderCategory,
  ProviderPackageExportResult,
  ProviderPackageImportPreview,
  ProviderService,
  UpdateProviderInput,
} from "../../services/provider"
import { createProviderServiceFromDataRepository, PROVIDER_SERVICE_ID } from "../../services/provider"
import { ProviderReferenceScanner } from "../../services/provider/provider-reference-scanner"
import { createProviderReferenceScannerDeps } from "../../services/provider/provider-reference-scanner-deps"
import { normalizeContentFileNameSegment } from "../../../src/lib/content-attachments"
import { createMainLogger } from "../../services/log-store"
import { resolveProjectAgent } from "./ipc-shared"

const logger = createMainLogger("agent.ipc")
const execFileAsync = promisify(execFile)

type CreateProviderIpcInput = Omit<CreateProviderInput, "env">
type UpdateProviderIpcInput = Omit<UpdateProviderInput, "env">

// ─── Request schemas ──────────────────────────────────────────────────────────

const openReferenceRequestSchema = projectRequestSchema.extend({
  reference: z.string().min(1),
})

const referenceActionRequestSchema = projectRequestSchema.extend({
  reference: z.string(),
}).strict()

const runtimeStatusRequestSchema = z.object({
  projectId: z.string().optional(),
})

const providerCategorySchema = z.enum([
  "official",
  "cn_official",
  "cloud_provider",
  "aggregator",
  "third_party",
  "custom",
]) satisfies z.ZodType<ProviderCategory>

const providerApiKeyFieldSchema = z.enum([
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
]) satisfies z.ZodType<ProviderApiKeyField>

const providerEnvSchema = z.record(z.string(), z.string())
const providerSettingsConfigSchema = z.record(z.string(), z.unknown())

const ccSwitchImportSourceSchema = z.object({
  kind: z.enum(["sqlite", "json"]),
  path: z.string().min(1),
}) satisfies z.ZodType<CcSwitchImportSource>

const createProviderInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  note: z.string().optional(),
  websiteUrl: z.string().optional(),
  category: providerCategorySchema,
  baseUrl: z.string().optional(),
  apiKeyField: providerApiKeyFieldSchema,
  apiKey: z.string().optional(),
  active: z.boolean().optional(),
  model: z.string().optional(),
  haikuModel: z.string().optional(),
  sonnetModel: z.string().optional(),
  opusModel: z.string().optional(),
  settingsConfig: providerSettingsConfigSchema.optional(),
  secretEnv: providerEnvSchema.optional(),
  sortIndex: z.number().optional(),
}) satisfies z.ZodType<CreateProviderIpcInput>

const updateProviderInputSchema = z.object({
  name: z.string().min(1).optional(),
  note: z.string().optional(),
  websiteUrl: z.string().optional(),
  category: providerCategorySchema.optional(),
  baseUrl: z.string().optional(),
  apiKeyField: providerApiKeyFieldSchema.optional(),
  apiKey: z.string().optional(),
  active: z.boolean().optional(),
  model: z.string().optional(),
  haikuModel: z.string().optional(),
  sonnetModel: z.string().optional(),
  opusModel: z.string().optional(),
  settingsConfig: providerSettingsConfigSchema.optional(),
  secretEnv: providerEnvSchema.optional(),
  clearSecretEnv: z.array(z.string()).optional(),
  archived: z.boolean().optional(),
  sortIndex: z.number().optional(),
}) satisfies z.ZodType<UpdateProviderIpcInput>

const providerRequestSchema = z.object({})

const createProviderRequestSchema = z.object({
  provider: createProviderInputSchema,
})

const updateProviderRequestSchema = z.object({
  providerId: z.string().min(1),
  patch: updateProviderInputSchema,
})

const providerIdRequestSchema = z.object({
  providerId: z.string().min(1),
})

const createProviderFromPresetRequestSchema = z.object({
  presetName: z.string().min(1),
  providerId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  templateValues: z.record(z.string(), z.string()).optional(),
  active: z.boolean().optional(),
  sortIndex: z.number().optional(),
})

const previewCcSwitchClaudeProvidersRequestSchema = z.object({
  source: ccSwitchImportSourceSchema.optional(),
})

const importCcSwitchClaudeProvidersRequestSchema = z.object({
  source: ccSwitchImportSourceSchema,
  providerIds: z.array(z.string().min(1)),
}) satisfies z.ZodType<ImportCcSwitchClaudeProvidersInput>

const providerPackagePathRequestSchema = z.object({
  sourcePath: z.string().min(1),
})

const providerPackageImportRequestSchema = providerPackagePathRequestSchema.extend({
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
})

const exportProviderPackageRequestSchema = z.object({
  providerId: z.string().min(1),
  targetPath: z.string().min(1),
})

// ─── Response schemas ─────────────────────────────────────────────────────────

const publishedCommandUiSchema = z.object({
  group: z.enum(["knowledge-base"]).optional(),
  label: z.string().optional(),
  action: z.enum(["send", "insert"]).optional(),
  insertText: z.string().optional(),
})

const publishedCommandSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  source: z.enum(["builtin", "custom", "skill", "agent-native"]),
  kind: z.enum(["builtin", "prompt", "exec", "skill", "agent-native"]),
  skillOrigin: z.enum(["synapse-installed", "other"]).optional(),
  adminOnly: z.boolean(),
  allowedPlatforms: z.array(z.string()).optional(),
  ui: publishedCommandUiSchema.optional(),
})

const openReferenceResultSchema = z.object({
  ok: z.literal(true),
  path: z.string(),
})

const agentReferenceActionErrorCodeSchema = z.enum(AGENT_REFERENCE_ACTION_ERROR_CODES)
const agentReferenceActionResultSchema = z.union([
  z.object({ ok: z.literal(true) }).strict(),
  z.object({
    ok: z.literal(false),
    code: agentReferenceActionErrorCodeSchema,
  }).strict(),
])

const providerSummarySchema = z.object({
  id: z.string(),
  display: z.string().optional(),
  active: z.boolean(),
  readonly: z.boolean().optional(),
  model: z.string().optional(),
  haikuModel: z.string().optional(),
  sonnetModel: z.string().optional(),
  opusModel: z.string().optional(),
  baseUrl: z.string().optional(),
  scope: z.enum(["global", "project"]),
})

const providerStateSchema = z.object({
  projectId: z.string().optional(),
  agentType: z.string(),
  providers: z.array(providerSummarySchema),
  activeProviderId: z.string().optional(),
  activeModel: z.string().optional(),
  activeMode: z.string().optional(),
})

const publicProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: providerCategorySchema,
  source: z.enum(["local", "user"]).optional(),
  readonly: z.boolean().optional(),
  configured: z.boolean().optional(),
  configPath: z.string().optional(),
  note: z.string().optional(),
  websiteUrl: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKeyField: providerApiKeyFieldSchema,
  active: z.boolean().optional(),
  model: z.string().optional(),
  haikuModel: z.string().optional(),
  sonnetModel: z.string().optional(),
  opusModel: z.string().optional(),
  settingsConfig: providerSettingsConfigSchema.optional(),
  archived: z.boolean().optional(),
  sortIndex: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const providerPresetTemplateValueSchema = z.object({
  key: z.string(),
  label: z.string(),
  placeholder: z.string(),
  defaultValue: z.string().optional(),
  sensitive: z.boolean(),
})

const publicProviderPresetSchema = z.object({
  name: z.string(),
  category: providerCategorySchema,
  websiteUrl: z.string().optional(),
  apiKeyUrl: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKeyField: providerApiKeyFieldSchema,
  model: z.string().optional(),
  haikuModel: z.string().optional(),
  sonnetModel: z.string().optional(),
  opusModel: z.string().optional(),
  templateValues: z.array(providerPresetTemplateValueSchema),
})

const ccSwitchImportPreviewItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: providerCategorySchema,
  websiteUrl: z.string().optional(),
  note: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKeyField: providerApiKeyFieldSchema,
  model: z.string().optional(),
  haikuModel: z.string().optional(),
  sonnetModel: z.string().optional(),
  opusModel: z.string().optional(),
  status: z.enum(["ready", "duplicate", "missing_api_key"]),
  selectedByDefault: z.boolean(),
})

const ccSwitchImportPreviewResultSchema = z.object({
  source: ccSwitchImportSourceSchema.optional(),
  items: z.array(ccSwitchImportPreviewItemSchema),
  error: z.string().optional(),
})

const ccSwitchImportResultSchema = z.object({
  imported: z.array(publicProviderSchema),
  skipped: z.array(ccSwitchImportPreviewItemSchema),
})

const providerPackageImportPreviewSchema = z.object({
  sourcePath: z.string(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  packageVersion: z.literal(1),
  sourceProviderId: z.string(),
  targetProviderId: z.string(),
  name: z.string(),
  category: providerCategorySchema,
  baseUrl: z.string().optional(),
  apiKeyField: providerApiKeyFieldSchema,
  model: z.string().optional(),
  haikuModel: z.string().optional(),
  sonnetModel: z.string().optional(),
  opusModel: z.string().optional(),
}) satisfies z.ZodType<ProviderPackageImportPreview>

const providerPackageImportResultSchema = z.object({
  provider: publicProviderSchema,
})

const providerPackageExportResultSchema = z.object({
  filePath: z.string(),
}) satisfies z.ZodType<ProviderPackageExportResult>

const chooseProviderPackageImportSourceResultSchema = z.object({
  sourcePath: z.string().optional(),
})

const chooseProviderPackageExportTargetResultSchema = z.object({
  targetPath: z.string().optional(),
})

const chooseCcSwitchImportSourceResultSchema = z.object({
  source: ccSwitchImportSourceSchema.optional(),
})

const okResultSchema = z.object({
  ok: z.literal(true),
})

const runtimeStatusSchema = z.object({
  projectId: z.string().optional(),
  agents: z.array(z.object({
    id: z.string(),
    label: z.string(),
    ready: z.boolean(),
    cli: z.object({
      required: z.boolean(),
      binary: z.string().optional(),
      installed: z.boolean(),
      path: z.string().nullable(),
    }),
    provider: z.object({
      projectId: z.string().optional(),
      configured: z.boolean(),
      activeProviderId: z.string().optional(),
      activeModel: z.string().optional(),
    }).optional(),
    issues: z.array(z.string()),
  })),
})

// ─── Types ────────────────────────────────────────────────────────────────────

type ProjectRequest = z.infer<typeof projectRequestSchema>
type OpenReferenceRequest = z.infer<typeof openReferenceRequestSchema>
type ReferenceActionRequest = z.infer<typeof referenceActionRequestSchema>
type ProviderRequest = z.infer<typeof providerRequestSchema>
type CreateProviderRequest = z.infer<typeof createProviderRequestSchema>
type UpdateProviderRequest = z.infer<typeof updateProviderRequestSchema>
type ProviderIdRequest = z.infer<typeof providerIdRequestSchema>
type CreateProviderFromPresetRequest = z.infer<typeof createProviderFromPresetRequestSchema>
type PreviewCcSwitchClaudeProvidersRequest = z.infer<typeof previewCcSwitchClaudeProvidersRequestSchema>
type ImportCcSwitchClaudeProvidersRequest = z.infer<typeof importCcSwitchClaudeProvidersRequestSchema>
type ProviderPackagePathRequest = z.infer<typeof providerPackagePathRequestSchema>
type ExportProviderPackageRequest = z.infer<typeof exportProviderPackageRequestSchema>

function publicProvider(provider: CCProvider): z.infer<typeof publicProviderSchema> {
  return {
    id: provider.id,
    name: provider.name,
    category: provider.category,
    source: provider.source,
    readonly: provider.readonly,
    configured: provider.configured,
    configPath: provider.configPath,
    note: provider.note,
    websiteUrl: provider.websiteUrl,
    baseUrl: provider.baseUrl,
    apiKeyField: provider.apiKeyField,
    active: provider.active,
    model: provider.model,
    haikuModel: provider.haikuModel,
    sonnetModel: provider.sonnetModel,
    opusModel: provider.opusModel,
    settingsConfig: provider.settingsConfig,
    archived: provider.archived,
    sortIndex: provider.sortIndex,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  }
}

function providerSummary(provider: CCProvider, activeProviderId?: string): z.infer<typeof providerSummarySchema> {
  return {
    id: provider.id,
    display: provider.name,
    active: provider.id === activeProviderId || Boolean(provider.active),
    readonly: provider.readonly,
    model: provider.model,
    haikuModel: provider.haikuModel,
    sonnetModel: provider.sonnetModel,
    opusModel: provider.opusModel,
    baseUrl: provider.baseUrl,
    scope: "global",
  }
}

function ccSwitchSourceFromPath(filePath: string): CcSwitchImportSource {
  return {
    kind: path.extname(filePath).toLowerCase() === ".json" ? "json" : "sqlite",
    path: filePath,
  }
}

function resolveGlobalProviderService(resolve: <T>(serviceId: string) => T) {
  try {
    return resolve<ProviderService>(PROVIDER_SERVICE_ID)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("Unknown service:")) {
      throw error
    }
  }

  return createProviderServiceFromDataRepository({
    dataRepository: resolve<DataRepository>("core.data-repository"),
    permissionGuard: resolve<PermissionGuard>("core.permission-guard"),
    auditSink: resolve<AuditSink>("core.audit-sink"),
    scanReferences: async (providerId) => {
      const scanner = new ProviderReferenceScanner(createProviderReferenceScannerDeps(resolve))
      return scanner.scan(providerId)
    },
  })
}

// ─── Tool/utility method descriptors ─────────────────────────────────────────

export const toolMethods: Record<string, IpcMethodDescriptor> = {
  getProviders: {
    kind: "invoke",
    operationId: "app.agent.operation.get_providers",
    request: providerRequestSchema,
    response: providerStateSchema,
    handler: async (ctx, _request: ProviderRequest) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      const providers = await providerService.listProviders()
      const activeProvider = await providerService.getActiveProvider()
      return {
        agentType: "claude-code",
        activeProviderId: activeProvider?.id,
        activeModel: activeProvider?.model,
        providers: providers.map((provider) => providerSummary(provider, activeProvider?.id)),
      }
    },
  },
  listProviders: {
    kind: "invoke",
    operationId: "app.agent.operation.list_providers",
    request: providerRequestSchema,
    response: z.array(publicProviderSchema),
    handler: async (ctx, _request: ProviderRequest) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      return (await providerService.listProviders()).map(publicProvider)
    },
  },
  listProviderPresets: {
    kind: "invoke",
    operationId: "app.agent.operation.list_provider_presets",
    request: providerRequestSchema,
    response: z.array(publicProviderPresetSchema),
    handler: async (ctx, _request: ProviderRequest) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      return providerService.listProviderPresets()
    },
  },
  createProvider: {
    kind: "invoke",
    operationId: "app.agent.operation.create_provider",
    request: createProviderRequestSchema,
    response: publicProviderSchema,
    handler: async (ctx, request: CreateProviderRequest) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      return publicProvider(await providerService.createProvider(request.provider as CreateProviderInput))
    },
  },
  createProviderFromPreset: {
    kind: "invoke",
    operationId: "app.agent.operation.create_provider_from_preset",
    request: createProviderFromPresetRequestSchema,
    response: publicProviderSchema,
    handler: async (ctx, request: CreateProviderFromPresetRequest) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      return publicProvider(await providerService.createProviderFromPreset(request as CreateProviderFromPresetInput))
    },
  },
  previewCcSwitchClaudeProviders: {
    kind: "invoke",
    operationId: "app.agent.operation.preview_cc_switch_claude_providers",
    request: previewCcSwitchClaudeProvidersRequestSchema,
    response: ccSwitchImportPreviewResultSchema,
    handler: async (ctx, request: PreviewCcSwitchClaudeProvidersRequest) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      return providerService.previewCcSwitchClaudeProviders(request.source, {
        actor: { kind: "user", id: "renderer" },
      })
    },
  },
  importCcSwitchClaudeProviders: {
    kind: "invoke",
    operationId: "app.agent.operation.import_cc_switch_claude_providers",
    request: importCcSwitchClaudeProvidersRequestSchema,
    response: ccSwitchImportResultSchema,
    handler: async (ctx, request: ImportCcSwitchClaudeProvidersRequest) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      const result = await providerService.importCcSwitchClaudeProviders(request, {
        actor: { kind: "user", id: "renderer" },
      })
      return {
        imported: result.imported.map(publicProvider),
        skipped: result.skipped,
      }
    },
  },
  chooseCcSwitchClaudeImportSource: {
    kind: "invoke",
    operationId: "app.agent.operation.choose_cc_switch_claude_import_source",
    request: z.object({}),
    response: chooseCcSwitchImportSourceResultSchema,
    handler: async () => {
      const options: OpenDialogOptions = {
        title: "选择 CC Switch 配置",
        properties: ["openFile"],
        filters: [
          { name: "CC Switch", extensions: ["db", "json"] },
        ],
      }
      const focusedWindow = BrowserWindow.getFocusedWindow()
      const result = focusedWindow
        ? await dialog.showOpenDialog(focusedWindow, options)
        : await dialog.showOpenDialog(options)
      const filePath = result.filePaths[0]
      if (result.canceled || !filePath) return {}
      return { source: ccSwitchSourceFromPath(filePath) }
    },
  },
  chooseProviderPackageImportSource: {
    kind: "invoke",
    operationId: "app.agent.operation.choose_provider_package_import_source",
    request: z.object({}),
    response: chooseProviderPackageImportSourceResultSchema,
    handler: async () => {
      const options: OpenDialogOptions = {
        title: "导入供应商",
        properties: ["openFile"],
        filters: [
          { name: "Synapse Provider", extensions: ["json"] },
        ],
      }
      const focusedWindow = BrowserWindow.getFocusedWindow()
      const result = focusedWindow
        ? await dialog.showOpenDialog(focusedWindow, options)
        : await dialog.showOpenDialog(options)
      const sourcePath = result.filePaths[0]
      if (result.canceled || !sourcePath) return {}
      return { sourcePath }
    },
  },
  chooseProviderPackageExportTarget: {
    kind: "invoke",
    operationId: "app.agent.operation.choose_provider_package_export_target",
    request: z.object({ providerName: z.string().min(1) }),
    response: chooseProviderPackageExportTargetResultSchema,
    handler: async (_ctx, request: { providerName: string }) => {
      const safeName = normalizeContentFileNameSegment(request.providerName, 80)
      const options = {
        title: "导出供应商",
        defaultPath: `${safeName}.synapse-provider.json`,
        filters: [{ name: "Synapse Provider", extensions: ["json"] }],
      }
      const focusedWindow = BrowserWindow.getFocusedWindow()
      const result = focusedWindow
        ? await dialog.showSaveDialog(focusedWindow, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return {}
      return { targetPath: result.filePath }
    },
  },
  previewProviderPackageImport: {
    kind: "invoke",
    operationId: "app.agent.operation.preview_provider_package_import",
    request: providerPackagePathRequestSchema,
    response: providerPackageImportPreviewSchema,
    handler: async (ctx, request: ProviderPackagePathRequest) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      return providerService.previewProviderPackageImport(request.sourcePath, {
        actor: { kind: "user", id: "renderer" },
      })
    },
  },
  importProviderPackage: {
    kind: "invoke",
    operationId: "app.agent.operation.import_provider_package",
    request: providerPackageImportRequestSchema,
    response: providerPackageImportResultSchema,
    handler: async (ctx, request: ProviderPackagePathRequest & { readonly contentSha256: string }) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      const result = await providerService.importProviderPackage(
        request.sourcePath,
        { contentSha256: request.contentSha256 },
        { actor: { kind: "user", id: "renderer" } },
      )
      return { provider: publicProvider(result.provider) }
    },
  },
  exportProviderPackage: {
    kind: "invoke",
    operationId: "app.agent.operation.export_provider_package",
    request: exportProviderPackageRequestSchema,
    response: providerPackageExportResultSchema,
    handler: async (ctx, request: ExportProviderPackageRequest) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      return providerService.exportProviderPackage(request.providerId, request.targetPath, {
        actor: { kind: "user", id: "renderer" },
      })
    },
  },
  updateProvider: {
    kind: "invoke",
    operationId: "app.agent.operation.update_provider",
    request: updateProviderRequestSchema,
    response: publicProviderSchema,
    handler: async (ctx, request: UpdateProviderRequest) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      return publicProvider(await providerService.updateProvider(request.providerId, request.patch))
    },
  },
  archiveProvider: {
    kind: "invoke",
    operationId: "app.agent.operation.archive_provider",
    request: providerIdRequestSchema,
    response: okResultSchema,
    handler: async (ctx, request: ProviderIdRequest) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      await providerService.archiveProvider(request.providerId)
      return { ok: true }
    },
  },
  deleteProvider: {
    kind: "invoke",
    operationId: "app.agent.operation.delete_provider",
    request: providerIdRequestSchema,
    response: okResultSchema,
    handler: async (ctx, request: ProviderIdRequest) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      await providerService.deleteProvider(request.providerId)
      return { ok: true }
    },
  },
  listAllProviders: {
    kind: "invoke",
    operationId: "app.agent.operation.list_all_providers",
    request: providerRequestSchema,
    response: z.array(publicProviderSchema),
    handler: async (ctx, _request: ProviderRequest) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      return (await providerService.listAllProviders()).map(publicProvider)
    },
  },
  scanProviderReferences: {
    kind: "invoke",
    operationId: "app.agent.operation.scan_provider_references",
    request: providerIdRequestSchema,
    response: z.object({
      providerId: z.string(),
      references: z.array(z.object({
        kind: z.enum(["workflow-node", "conversation", "agent-persona"]),
        entityId: z.string(),
        entityName: z.string(),
        projectId: z.string().optional(),
        nodeId: z.string().optional(),
        nodeName: z.string().optional(),
        providerId: z.string(),
        modelTier: z.string(),
      })),
      workflowNodeCount: z.number(),
      conversationCount: z.number(),
      agentPersonaCount: z.number(),
    }),
    handler: async (ctx, request: ProviderIdRequest) => {
      const scanner = new ProviderReferenceScanner(createProviderReferenceScannerDeps(ctx.resolve))
      return scanner.scan(request.providerId)
    },
  },
  migrateProviderReferences: {
    kind: "invoke",
    operationId: "app.agent.operation.migrate_provider_references",
    request: z.object({
      sourceProviderId: z.string().min(1),
      targetProviderId: z.string().min(1),
      targetModelTier: z.string().min(1),
      scope: z.array(z.enum(["workflow-node"])),
    }),
    response: z.object({
      migratedWorkflowNodes: z.number(),
      errors: z.array(z.object({ entityId: z.string(), error: z.string() })),
    }),
    handler: async (ctx, request: {
      sourceProviderId: string
      targetProviderId: string
      targetModelTier: string
      scope: "workflow-node"[]
    }) => {
      const scanner = new ProviderReferenceScanner(createProviderReferenceScannerDeps(ctx.resolve))
      return scanner.migrate({
        sourceProviderId: request.sourceProviderId,
        targetProviderId: request.targetProviderId,
        targetModelTier: request.targetModelTier as "default" | "haiku" | "sonnet" | "opus",
        scope: request.scope,
      })
    },
  },
  setActiveProvider: {
    kind: "invoke",
    operationId: "app.agent.operation.set_active_provider",
    request: providerIdRequestSchema,
    response: okResultSchema,
    handler: async (ctx, request: ProviderIdRequest) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      await providerService.setActiveProvider(request.providerId)
      return { ok: true }
    },
  },
  getRuntimeStatus: {
    kind: "invoke",
    operationId: "app.agent.operation.get_runtime_status",
    request: runtimeStatusRequestSchema,
    response: runtimeStatusSchema,
    handler: async (ctx, request: { projectId?: string }) => {
      const providerService = resolveGlobalProviderService(ctx.resolve)
      const providers = await providerService.listProviders()
      const activeProvider = await providerService.getActiveProvider()
      const providerConfigured = Boolean(activeProvider && providers.length > 0)
      const issues: string[] = []
      if (!providerConfigured) issues.push("provider-not-configured")
      if (activeProvider && !activeProvider.model) issues.push("model-not-selected")
      return {
        projectId: request.projectId,
        agents: [{
          id: "claude-code",
          label: "CC/Synapse",
          ready: issues.length === 0,
          cli: {
            required: false,
            installed: true,
            path: null,
          },
          provider: {
            projectId: request.projectId,
            configured: providerConfigured,
            activeProviderId: activeProvider?.id,
            activeModel: activeProvider?.model,
          },
          issues,
        }],
      }
    },
  },
  getAvailableAgents: {
    kind: "invoke",
    operationId: "app.agent.operation.get_available_agents",
    request: z.object({}),
    response: z.array(z.object({
      agentType: z.string(),
      label: z.string(),
      available: z.boolean(),
      binaryPath: z.string().optional(),
    })),
    handler: async () => {
      return [{
        agentType: "claude-code",
        label: "CC/Synapse",
        available: true,
      }]
    },
  },
  listCommands: {
    kind: "invoke",
    operationId: "app.agent.operation.list_commands",
    request: projectRequestSchema,
    response: z.array(publishedCommandSchema),
    handler: async (ctx, request: ProjectRequest) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return agent.listPublishedCommands("local-renderer")
    },
  },
  openReference: {
    kind: "invoke",
    operationId: "app.agent.operation.open_reference",
    request: openReferenceRequestSchema,
    response: openReferenceResultSchema,
    handler: async (ctx, request: OpenReferenceRequest) => {
      try {
        const { project } = await resolveProjectAgent(ctx.resolve, request.projectId)
        const reference = resolveLocalReference(request.reference, project.localPath, {
          allowOutsideWorkspace: true,
        })
        if (!reference) throw new Error("Reference is outside the workspace or invalid.")
        const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
        const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
        const actor = { kind: "user" as const, id: "renderer" }
        const permission = await permissionGuard.check({
          action: "fs.read.outside-userdata",
          actor,
          resource: reference.path,
          context: {
            projectId: request.projectId,
            command: "open-reference",
          },
        })
        if (!permission.allowed) {
          auditSink.record({
            action: "fs.read.outside-userdata",
            actor,
            resource: reference.path,
            outcome: "denied",
            metadata: {
              projectId: request.projectId,
              reason: permission.reason,
              policyId: permission.policyId,
            },
          })
          throw new Error(permission.reason)
        }
        const shellMetadata = {
          projectId: request.projectId,
          command: "open-reference",
          line: reference.line,
        }
        const shellPermission = await permissionGuard.check({
          action: "shell.exec",
          actor,
          resource: reference.path,
          context: shellMetadata,
        })
        if (!shellPermission.allowed) {
          auditSink.record({
            action: "shell.exec",
            actor,
            resource: reference.path,
            outcome: "denied",
            metadata: {
              ...shellMetadata,
              reason: shellPermission.reason,
              policyId: shellPermission.policyId,
            },
          })
          throw new Error(shellPermission.reason)
        }
        let error: string | undefined
        try {
          if (reference.line !== undefined && await openFileWithLine(reference.path, reference.line)) {
            error = undefined
          } else {
            error = await shell.openPath(reference.path)
          }
        } catch (openError) {
          auditSink.record({
            action: "shell.exec",
            actor,
            resource: reference.path,
            outcome: "failed",
            metadata: {
              ...shellMetadata,
              boundary: "agent.ipc.open-reference.shell",
              ...shellOpenErrorMetadata(openError),
            },
          })
          auditSink.record({
            action: "fs.read.outside-userdata",
            actor,
            resource: reference.path,
            outcome: "failed",
            metadata: {
              projectId: request.projectId,
              command: "open-reference",
              line: reference.line,
              boundary: "agent.ipc.open-reference.shell",
              ...shellOpenErrorMetadata(openError),
            },
          })
          throw openError
        }
        auditSink.record({
          action: "shell.exec",
          actor,
          resource: reference.path,
          outcome: error ? "failed" : "allowed",
          metadata: {
            ...shellMetadata,
            ...(error
              ? {
                  boundary: "agent.ipc.open-reference.shell",
                  ...shellOpenErrorMetadata(error),
                }
              : {}),
          },
        })
        auditSink.record({
          action: "fs.read.outside-userdata",
          actor,
          resource: reference.path,
          outcome: error ? "failed" : "allowed",
          metadata: {
            projectId: request.projectId,
            command: "open-reference",
            line: reference.line,
            ...(error
              ? {
                  boundary: "agent.ipc.open-reference.shell",
                  ...shellOpenErrorMetadata(error),
                }
              : {}),
          },
        })
        if (error) throw new Error(error)
        return { ok: true, path: reference.path }
      } catch (error) {
        logger.warn("Agent open reference IPC failed.", {
          projectId: request.projectId,
          boundary: "agent.open-reference.ipc",
          referenceLength: request.reference.length,
          ...shellOpenErrorMetadata(error),
        })
        throw error
      }
    },
  },
  openReferenceDefault: {
    kind: "invoke",
    operationId: "app.agent.reference.open_default",
    request: referenceActionRequestSchema,
    response: agentReferenceActionResultSchema,
    handler: (ctx, request: ReferenceActionRequest) =>
      runReferenceAction(ctx, request, "open_default"),
  },
  showReferenceInFolder: {
    kind: "invoke",
    operationId: "app.agent.reference.show_in_folder",
    request: referenceActionRequestSchema,
    response: agentReferenceActionResultSchema,
    handler: (ctx, request: ReferenceActionRequest) =>
      runReferenceAction(ctx, request, "show_in_folder"),
  },
}

async function runReferenceAction(
  ctx: IpcHandlerContext,
  request: ReferenceActionRequest,
  action: AgentReferenceActionKind,
): Promise<AgentReferenceActionResult> {
  if ([...request.reference].length > AGENT_REFERENCE_MAX_CODE_POINTS) {
    logger.warn("Agent reference action validation failed.", {
      action,
      code: "invalid_reference",
      stage: "input_length",
    })
    return { ok: false, code: "invalid_reference" }
  }

  const service = ctx.resolve<AgentReferenceActionService>(AGENT_REFERENCE_ACTION_SERVICE_ID)
  const validation = service.validateInput(request.reference)
  if (!validation.ok) {
    logger.warn("Agent reference action validation failed.", {
      action,
      code: validation.code,
      stage: "input_validation",
    })
    return validation
  }

  let projectRoot: string
  try {
    const { project } = await resolveProjectAgent(ctx.resolve, request.projectId)
    projectRoot = project.localPath
  } catch {
    logger.warn("Agent reference action project unavailable.", {
      action,
      code: "project_unavailable",
    })
    return { ok: false, code: "project_unavailable" }
  }

  const senderAbort = observeSender(ctx.sender)
  try {
    const input = {
      projectId: request.projectId,
      projectRoot,
      reference: request.reference,
      actor: { kind: "user" as const, id: "renderer" },
      abortSignal: senderAbort.signal,
    }
    return action === "open_default"
      ? await service.openDefault(input)
      : await service.showInFolder(input)
  } catch (error) {
    logger.warn("Agent reference action IPC invariant failure.", {
      action,
      result: "ipc_failure",
      errorName: error instanceof Error ? error.name : typeof error,
    })
    // The original error can contain a local path or native message and must not cross IPC.
    // eslint-disable-next-line preserve-caught-error
    throw new Error("Agent reference action failed unexpectedly.")
  } finally {
    senderAbort.dispose()
  }
}

function observeSender(sender: IpcInvocationSender | undefined): {
  readonly signal?: AbortSignal
  readonly dispose: () => void
} {
  if (!sender) return { dispose: () => undefined }
  const controller = new AbortController()
  if (sender.isDestroyed()) {
    controller.abort()
    return { signal: controller.signal, dispose: () => undefined }
  }
  const dispose = sender.onDestroyed(() => controller.abort())
  return { signal: controller.signal, dispose }
}

/** Try opening a file at a specific line using a known editor CLI. */
async function openFileWithLine(filePath: string, line: number): Promise<boolean> {
  const editors = ["cursor", "code", "code-insiders"]
  const target = `${filePath}:${line}`
  for (const editor of editors) {
    try {
      if (process.platform === "win32") {
        const command = [quoteWindowsCommandArg(`${editor}.cmd`), "--goto", quoteWindowsCommandArg(target)].join(" ")
        await execFileAsync("cmd.exe", ["/d", "/s", "/c", command], {
          timeout: 5000,
          windowsHide: true,
        })
      } else {
        await execFileAsync(editor, ["--goto", target], { timeout: 5000 })
      }
      return true
    } catch {
      continue
    }
  }
  return false
}

function shellOpenErrorMetadata(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}
