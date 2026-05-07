import { shell } from "electron"
import { z } from "zod"

import type { IpcMethodDescriptor } from "../../runtime/ipc/types"
import { projectRequestSchema } from "../../runtime/ipc/schemas"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { resolveLocalReference } from "../../services/agent-runtime/references"
import { whichBin } from "../../services/agent-runtime/binary-detect-service"
import { AgentAvailabilityService } from "../../services/agent-runtime/agent-availability-service"
import { agentRuntimeDefinitions } from "../../services/definitions/generated/main-registry"
import { resolveProjectAgent } from "./ipc-shared"

// ─── Request schemas ──────────────────────────────────────────────────────────

const openReferenceRequestSchema = projectRequestSchema.extend({
  reference: z.string().min(1),
})

const runtimeStatusRequestSchema = z.object({
  projectId: z.string().optional(),
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

// ─── Tool/utility method descriptors ─────────────────────────────────────────

export const toolMethods: Record<string, IpcMethodDescriptor> = {
  getProviders: {
    kind: "invoke",
    channel: "synapse:agent:get-providers",
    request: projectRequestSchema,
    response: providerStateSchema,
    handler: async (ctx, request: ProjectRequest) => {
      const { providerConfig } = await resolveProjectAgent(ctx.resolve, request.projectId)
      const agentType = await providerConfig.getActiveAgentType(request.projectId, "codex")
      const state = await providerConfig.getProjectProviderState(request.projectId, agentType)
      return {
        projectId: state.projectId,
        agentType: state.agentType,
        activeProviderId: state.activeProviderId,
        activeModel: state.activeModel,
        activeMode: state.activeMode,
        providers: state.providers.map((provider) => ({
          id: provider.id,
          display: provider.display,
          active: provider.id === state.activeProviderId,
          model: provider.model,
          baseUrl: provider.baseUrl,
          scope: provider.scope,
        })),
      }
    },
  },
  getRuntimeStatus: {
    kind: "invoke",
    channel: "synapse:agent:get-runtime-status",
    request: runtimeStatusRequestSchema,
    response: runtimeStatusSchema,
    handler: async (ctx, request: { projectId?: string }) => {
      const providerConfig = request.projectId
        ? (await resolveProjectAgent(ctx.resolve, request.projectId)).providerConfig
        : undefined
      const agents = await Promise.all(agentRuntimeDefinitions.map(async (definition) => {
        const binary = definition.runtime.binaries[0]
        const path = binary ? await whichBin(binary) : null
        const provider = request.projectId && providerConfig
          ? await providerConfig.getProjectProviderState(request.projectId, definition.id)
          : undefined
        const activeProvider = provider?.activeProvider
        const providerConfigured = Boolean(provider && provider.providers.length > 0)
        const issues: string[] = []
        if (binary && !path) issues.push("cli-not-installed")
        if (request.projectId && !providerConfigured) {
          issues.push("provider-not-configured")
        }
        if (request.projectId && activeProvider && !provider.activeModel) {
          issues.push("model-not-selected")
        }
        return {
          id: definition.id,
          label: definition.label,
          ready: issues.length === 0,
          cli: {
            required: definition.runtime.kind === "local-cli",
            binary,
            installed: path !== null,
            path,
          },
          provider: request.projectId ? {
            projectId: request.projectId,
            configured: providerConfigured,
            activeProviderId: activeProvider?.id,
            activeModel: activeProvider ? provider?.activeModel : undefined,
          } : undefined,
          issues,
        }
      }))
      return {
        projectId: request.projectId,
        agents,
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
      const service = new AgentAvailabilityService({
        whichBin,
        definitions: agentRuntimeDefinitions.map((def) => ({
          id: def.id,
          label: def.label,
          runtime: def.runtime,
        })),
      })
      return await service.detectAll()
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
