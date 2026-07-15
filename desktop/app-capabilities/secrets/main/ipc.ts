import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { WindowManager } from "../../../electron/runtime/window"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import {
  SECRETS_ITEM_CREATE_CAPABILITY_ID,
  SECRETS_ITEM_DELETE_CAPABILITY_ID,
  SECRETS_ITEM_GET_CAPABILITY_ID,
  SECRETS_ITEM_LIST_CAPABILITY_ID,
  SECRETS_ITEM_UPDATE_CAPABILITY_ID,
  SECRETS_ITEM_UPSERT_CAPABILITY_ID,
} from "../shared/capability"
import type { SecretsService } from "./service"
import { createSecretsCapabilityDispatcher, runAuthorizedSecretOperation } from "./dispatcher"
import {
  secretCreateInputSchema,
  secretDeleteInputSchema,
  secretGetInputSchema,
  secretListResultSchema,
  secretSkillEnvQueueInputSchema,
  secretSkillEnvQueueResultSchema,
  secretSkillEnvBatchScanInputSchema,
  secretSkillEnvBatchScanResultSchema,
  secretSkillEnvScanInputSchema,
  secretSkillEnvScanResultSchema,
  secretSafeViewSchema,
  secretUpdateInputSchema,
  secretUpsertInputSchema,
  secretUpsertResultSchema,
  secretValueViewSchema,
  secretsChangedEventSchema,
} from "../shared/schema"

const wiredServices = new WeakSet<SecretsService>()
const SECRETS_APP_ACTOR = { kind: "user", id: "secrets-app", display: "Secrets App" } as const
const SECRETS_SKILL_ENV_SCAN_OPERATION = "secrets.skill-env.scan"
const SECRETS_SKILL_ENV_QUEUE_OPERATION = "secrets.skill-env.queue"
const secretEnvelopeSchema = z.object({
  secret: z.union([secretValueViewSchema, secretSafeViewSchema]),
}).passthrough()

type SecretsIpcContext = Parameters<IpcModule["methods"][string]["handler"]>[0]

function resolveSecretsService(ctx: SecretsIpcContext): SecretsService {
  const service = ctx.resolve<SecretsService>("core.secrets")
  if (!wiredServices.has(service)) {
    const windowManager = ctx.resolve<WindowManager>("core.window-manager")
    service.events.on("changed", (payload) => {
      windowManager.broadcast(secretsIpcModule.events.changed.channel, payload)
    })
    wiredServices.add(service)
  }
  return service
}

async function dispatchSecretsAction(
  ctx: SecretsIpcContext,
  action: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const dispatcher = createSecretsCapabilityDispatcher({
    service: resolveSecretsService(ctx),
    permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
    auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
    actor: SECRETS_APP_ACTOR,
  })
  const result = await dispatcher.dispatch(action, params, {
    source: "api",
    actor: SECRETS_APP_ACTOR,
  })
  if (!result.ok) throw new Error(result.error ?? "密钥操作失败。")
  return result.data
}

export const secretsIpcModule: IpcModule = {
  id: "secrets",
  methods: {
    list: {
      channel: "synapse:secrets:list",
      kind: "invoke",
      request: z.void(),
      response: secretListResultSchema,
      handler: async (ctx) => secretListResultSchema.parse(
        await dispatchSecretsAction(ctx, SECRETS_ITEM_LIST_CAPABILITY_ID, {}),
      ),
    },
    get: {
      channel: "synapse:secrets:get",
      kind: "invoke",
      request: secretGetInputSchema,
      response: z.union([secretValueViewSchema, secretSafeViewSchema]),
      handler: async (ctx, request) => secretEnvelopeSchema.parse(
        await dispatchSecretsAction(ctx, SECRETS_ITEM_GET_CAPABILITY_ID, secretGetInputSchema.parse(request)),
      ).secret,
    },
    create: {
      channel: "synapse:secrets:create",
      kind: "invoke",
      request: secretCreateInputSchema,
      response: secretSafeViewSchema,
      handler: async (ctx, request) => secretSafeViewSchema.parse(secretEnvelopeSchema.parse(
        await dispatchSecretsAction(ctx, SECRETS_ITEM_CREATE_CAPABILITY_ID, secretCreateInputSchema.parse(request)),
      ).secret),
    },
    update: {
      channel: "synapse:secrets:update",
      kind: "invoke",
      request: secretUpdateInputSchema,
      response: secretSafeViewSchema,
      handler: async (ctx, request) => secretSafeViewSchema.parse(secretEnvelopeSchema.parse(
        await dispatchSecretsAction(ctx, SECRETS_ITEM_UPDATE_CAPABILITY_ID, secretUpdateInputSchema.parse(request)),
      ).secret),
    },
    upsert: {
      channel: "synapse:secrets:upsert",
      kind: "invoke",
      request: secretUpsertInputSchema,
      response: secretUpsertResultSchema,
      handler: async (ctx, request) => secretUpsertResultSchema.parse(
        await dispatchSecretsAction(ctx, SECRETS_ITEM_UPSERT_CAPABILITY_ID, secretUpsertInputSchema.parse(request)),
      ),
    },
    delete: {
      channel: "synapse:secrets:delete",
      kind: "invoke",
      request: secretDeleteInputSchema,
      response: secretSafeViewSchema,
      handler: async (ctx, request) => secretSafeViewSchema.parse(secretEnvelopeSchema.parse(
        await dispatchSecretsAction(ctx, SECRETS_ITEM_DELETE_CAPABILITY_ID, secretDeleteInputSchema.parse(request)),
      ).secret),
    },
    scanSkillEnvBindings: {
      channel: "synapse:secrets:scan-skill-env-bindings",
      kind: "invoke",
      request: secretSkillEnvScanInputSchema,
      response: secretSkillEnvScanResultSchema,
      handler: async (ctx, request) => {
        const input = secretSkillEnvScanInputSchema.parse(request)
        const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
        const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
        return runAuthorizedSecretOperation({ permissionGuard, auditSink, actor: SECRETS_APP_ACTOR }, {
          action: "secret.read",
          operation: SECRETS_SKILL_ENV_SCAN_OPERATION,
          context: { source: "api", actor: SECRETS_APP_ACTOR },
          secretName: input.name,
          includeValue: true,
        }, () => resolveSecretsService(ctx).scanSkillEnvBindings(input, {
          actor: SECRETS_APP_ACTOR,
          permissionGuard,
          auditSink,
        }))
      },
    },
    scanSkillEnvBindingsBatch: {
      channel: "synapse:secrets:scan-skill-env-bindings-batch",
      kind: "invoke",
      request: secretSkillEnvBatchScanInputSchema,
      response: secretSkillEnvBatchScanResultSchema,
      handler: async (ctx, request) => {
        const input = secretSkillEnvBatchScanInputSchema.parse(request)
        const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
        const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
        const security = { permissionGuard, auditSink, actor: SECRETS_APP_ACTOR }
        const runScan = input.names.reduceRight<() => Promise<unknown>>(
          (next, name) => () => runAuthorizedSecretOperation(security, {
            action: "secret.read",
            operation: SECRETS_SKILL_ENV_SCAN_OPERATION,
            context: { source: "api", actor: SECRETS_APP_ACTOR },
            secretName: name,
            includeValue: true,
          }, next),
          () => resolveSecretsService(ctx).scanSkillEnvBindingsBatch(input, security),
        )
        return secretSkillEnvBatchScanResultSchema.parse(await runScan())
      },
    },
    queueSkillEnvBindings: {
      channel: "synapse:secrets:queue-skill-env-bindings",
      kind: "invoke",
      request: secretSkillEnvQueueInputSchema,
      response: secretSkillEnvQueueResultSchema,
      handler: async (ctx, request) => {
        const input = secretSkillEnvQueueInputSchema.parse(request)
        const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
        const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
        return runAuthorizedSecretOperation({ permissionGuard, auditSink, actor: SECRETS_APP_ACTOR }, {
          action: "secret.write",
          operation: SECRETS_SKILL_ENV_QUEUE_OPERATION,
          context: { source: "api", actor: SECRETS_APP_ACTOR },
          secretName: input.name,
          includeValue: true,
        }, () => resolveSecretsService(ctx).queueSkillEnvBindings(input, {
          actor: SECRETS_APP_ACTOR,
          permissionGuard,
          auditSink,
        }))
      },
    },
  },
  events: {
    changed: {
      channel: "synapse:secrets:changed",
      kind: "event",
      payload: secretsChangedEventSchema,
    },
  },
}
