import { shell } from "electron"
import { z } from "zod"

import type { IpcMethodDescriptor } from "../../runtime/ipc/types"
import { projectRequestSchema } from "../../runtime/ipc/schemas"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { resolveLocalReference } from "../../services/agent-runtime/references"
import type {
  CCProvider,
  CreateProviderInput,
  ProviderApiKeyField,
  ProviderCategory,
  UpdateProviderInput,
} from "../../services/provider"
import { resolveProjectAgent } from "./ipc-shared"

// ─── Request schemas ──────────────────────────────────────────────────────────

const openReferenceRequestSchema = projectRequestSchema.extend({
  reference: z.string().min(1),
})

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

const createProviderInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: providerCategorySchema,
  baseUrl: z.string().optional(),
  apiKeyField: providerApiKeyFieldSchema,
  apiKey: z.string().optional(),
  active: z.boolean().optional(),
  model: z.string().optional(),
  haikuModel: z.string().optional(),
  sonnetModel: z.string().optional(),
  opusModel: z.string().optional(),
  env: providerEnvSchema.default({}),
  sortIndex: z.number().optional(),
}) satisfies z.ZodType<CreateProviderInput>

const updateProviderInputSchema = z.object({
  name: z.string().min(1).optional(),
  category: providerCategorySchema.optional(),
  baseUrl: z.string().optional(),
  apiKeyField: providerApiKeyFieldSchema.optional(),
  apiKey: z.string().optional(),
  active: z.boolean().optional(),
  model: z.string().optional(),
  haikuModel: z.string().optional(),
  sonnetModel: z.string().optional(),
  opusModel: z.string().optional(),
  env: providerEnvSchema.optional(),
  archived: z.boolean().optional(),
  sortIndex: z.number().optional(),
}) satisfies z.ZodType<UpdateProviderInput>

const createProviderRequestSchema = projectRequestSchema.extend({
  provider: createProviderInputSchema,
})

const updateProviderRequestSchema = projectRequestSchema.extend({
  providerId: z.string().min(1),
  patch: updateProviderInputSchema,
})

const providerIdRequestSchema = projectRequestSchema.extend({
  providerId: z.string().min(1),
})

// ─── Response schemas ─────────────────────────────────────────────────────────

const publishedCommandSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  source: z.enum(["builtin", "custom", "skill", "agent-native"]),
  kind: z.enum(["builtin", "prompt", "exec", "skill", "agent-native"]),
  adminOnly: z.boolean(),
  allowedPlatforms: z.array(z.string()).optional(),
})

const openReferenceResultSchema = z.object({
  ok: z.literal(true),
  path: z.string(),
})

const providerSummarySchema = z.object({
  id: z.string(),
  display: z.string().optional(),
  active: z.boolean(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  scope: z.enum(["global", "project"]),
})

const providerStateSchema = z.object({
  projectId: z.string(),
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
  baseUrl: z.string().optional(),
  apiKeyField: providerApiKeyFieldSchema,
  active: z.boolean().optional(),
  model: z.string().optional(),
  haikuModel: z.string().optional(),
  sonnetModel: z.string().optional(),
  opusModel: z.string().optional(),
  archived: z.boolean().optional(),
  sortIndex: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
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
type CreateProviderRequest = z.infer<typeof createProviderRequestSchema>
type UpdateProviderRequest = z.infer<typeof updateProviderRequestSchema>
type ProviderIdRequest = z.infer<typeof providerIdRequestSchema>

function publicProvider(provider: CCProvider): z.infer<typeof publicProviderSchema> {
  return {
    id: provider.id,
    name: provider.name,
    category: provider.category,
    baseUrl: provider.baseUrl,
    apiKeyField: provider.apiKeyField,
    active: provider.active,
    model: provider.model,
    haikuModel: provider.haikuModel,
    sonnetModel: provider.sonnetModel,
    opusModel: provider.opusModel,
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
    model: provider.model,
    baseUrl: provider.baseUrl,
    scope: "global",
  }
}

// ─── Tool/utility method descriptors ─────────────────────────────────────────

export const toolMethods: Record<string, IpcMethodDescriptor> = {
  getProviders: {
    kind: "invoke",
    channel: "synapse:agent:get-providers",
    request: projectRequestSchema,
    response: providerStateSchema,
    handler: async (ctx, request: ProjectRequest) => {
      const { providerService } = await resolveProjectAgent(ctx.resolve, request.projectId)
      const providers = await providerService.listProviders()
      const activeProvider = await providerService.getActiveProvider()
      return {
        projectId: request.projectId,
        agentType: "claude-code",
        activeProviderId: activeProvider?.id,
        activeModel: activeProvider?.model,
        providers: providers.map((provider) => providerSummary(provider, activeProvider?.id)),
      }
    },
  },
  listProviders: {
    kind: "invoke",
    channel: "synapse:agent:list-providers",
    request: projectRequestSchema,
    response: z.array(publicProviderSchema),
    handler: async (ctx, request: ProjectRequest) => {
      const { providerService } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return (await providerService.listProviders()).map(publicProvider)
    },
  },
  createProvider: {
    kind: "invoke",
    channel: "synapse:agent:create-provider",
    request: createProviderRequestSchema,
    response: publicProviderSchema,
    handler: async (ctx, request: CreateProviderRequest) => {
      const { providerService } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return publicProvider(await providerService.createProvider(request.provider))
    },
  },
  updateProvider: {
    kind: "invoke",
    channel: "synapse:agent:update-provider",
    request: updateProviderRequestSchema,
    response: publicProviderSchema,
    handler: async (ctx, request: UpdateProviderRequest) => {
      const { providerService } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return publicProvider(await providerService.updateProvider(request.providerId, request.patch))
    },
  },
  archiveProvider: {
    kind: "invoke",
    channel: "synapse:agent:archive-provider",
    request: providerIdRequestSchema,
    response: okResultSchema,
    handler: async (ctx, request: ProviderIdRequest) => {
      const { providerService } = await resolveProjectAgent(ctx.resolve, request.projectId)
      await providerService.archiveProvider(request.providerId)
      return { ok: true }
    },
  },
  setActiveProvider: {
    kind: "invoke",
    channel: "synapse:agent:set-active-provider",
    request: providerIdRequestSchema,
    response: okResultSchema,
    handler: async (ctx, request: ProviderIdRequest) => {
      const { providerService } = await resolveProjectAgent(ctx.resolve, request.projectId)
      await providerService.setActiveProvider(request.providerId)
      return { ok: true }
    },
  },
  getRuntimeStatus: {
    kind: "invoke",
    channel: "synapse:agent:get-runtime-status",
    request: runtimeStatusRequestSchema,
    response: runtimeStatusSchema,
    handler: async (ctx, request: { projectId?: string }) => {
      const providerService = request.projectId
        ? (await resolveProjectAgent(ctx.resolve, request.projectId)).providerService
        : undefined
      const providers = providerService ? await providerService.listProviders() : []
      const activeProvider = providerService
        ? await providerService.getActiveProvider()
        : undefined
      const providerConfigured = Boolean(activeProvider && providers.length > 0)
      const issues: string[] = []
      if (request.projectId && !providerConfigured) issues.push("provider-not-configured")
      if (request.projectId && activeProvider && !activeProvider.model) issues.push("model-not-selected")
      return {
        projectId: request.projectId,
        agents: [{
          id: "claude-code",
          label: "Claude Code",
          ready: issues.length === 0,
          cli: {
            required: false,
            installed: true,
            path: null,
          },
          provider: request.projectId ? {
            projectId: request.projectId,
            configured: providerConfigured,
            activeProviderId: activeProvider?.id,
            activeModel: activeProvider?.model,
          } : undefined,
          issues,
        }],
      }
    },
  },
  getAvailableAgents: {
    kind: "invoke",
    channel: "synapse:agent:get-available-agents",
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
        label: "Claude Code",
        available: true,
      }]
    },
  },
  listCommands: {
    kind: "invoke",
    channel: "synapse:agent:list-commands",
    request: projectRequestSchema,
    response: z.array(publishedCommandSchema),
    handler: async (ctx, request: ProjectRequest) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return agent.listPublishedCommands("local-renderer")
    },
  },
  openReference: {
    kind: "invoke",
    channel: "synapse:agent:open-reference",
    request: openReferenceRequestSchema,
    response: openReferenceResultSchema,
    handler: async (ctx, request: OpenReferenceRequest) => {
      const { project } = await resolveProjectAgent(ctx.resolve, request.projectId)
      const reference = resolveLocalReference(request.reference, project.localPath)
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
      const error = await shell.openPath(reference.path)
      auditSink.record({
        action: "fs.read.outside-userdata",
        actor,
        resource: reference.path,
        outcome: error ? "failed" : "allowed",
        metadata: {
          projectId: request.projectId,
          command: "open-reference",
          line: reference.line,
          error: error || undefined,
        },
      })
      if (error) throw new Error(error)
      return { ok: true, path: reference.path }
    },
  },
}
