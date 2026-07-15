import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type {
  SynapseInstallSourceToEditorPayload,
  SynapseInstallSourceToEditorTargetsPayload,
  SynapsePrepareInlineRuleSourcePayload,
  SynapsePrepareLocalSkillSourcePayload,
  SynapseSkillInstallerSource,
} from "../../../src/types/installers"
import type { EventBus } from "../../runtime/event-bus"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { createSecretsCapabilityDispatcher } from "../../../app-capabilities/secrets/main/dispatcher"
import type { SecretsService } from "../../../app-capabilities/secrets/main/service"
import { SECRETS_ITEM_GET_CAPABILITY_ID } from "../../../app-capabilities/secrets/shared/capability"
import { secretValueViewSchema } from "../../../app-capabilities/secrets/shared/schema"
import { editorInstallService } from "../../services/editor-install-service"
import { installerSourceService } from "../../services/installer-source-service"
import { createMainLogger } from "../../services/log-store"
import { notifyInstallStatusChanged } from "../install-status-events"

const logger = createMainLogger("ipc.installers")

const prepareLocalSkillSourceSchema = z.object({
  sourceDirectoryPath: z.string().min(1),
}).strict()

const prepareInlineRuleSourceSchema = z.object({
  body: z.string(),
  name: z.string(),
}).strict()

const installerSourceBaseSchema = z.object({
  description: z.string().optional(),
  name: z.string(),
  sourceFingerprint: z.string().optional(),
  sourceIdentity: z.string().min(1),
  title: z.string().optional(),
}).strict()

const skillInstallerSourceSchema = installerSourceBaseSchema.extend({
  kind: z.literal("skill"),
  localSourceId: z.string().optional(),
  mainContent: z.string().optional(),
  origin: z.enum(["repository", "prepared", "local-directory", "inline"]),
  preparedSourceId: z.string().optional(),
  repositoryContentId: z.string().optional(),
}).strict()

const ruleInstallerSourceSchema = installerSourceBaseSchema.extend({
  body: z.string().optional(),
  inlineSourceId: z.string().optional(),
  kind: z.literal("rule"),
  origin: z.enum(["repository", "prepared", "local-directory", "inline"]),
  preparedSourceId: z.string().optional(),
  repositoryContentId: z.string().optional(),
}).strict()

const installerSourceSchema = z.discriminatedUnion("kind", [
  skillInstallerSourceSchema,
  ruleInstallerSourceSchema,
])

const installSourceToEditorSchema = z.object({
  editorId: z.string().min(1),
  installFormValues: z.record(z.string(), z.unknown()).optional(),
  overwriteConfirmed: z.boolean().optional(),
  projectPath: z.string().optional(),
  replaceConfirmed: z.boolean().optional(),
  replacedSourceIdentity: z.string().optional(),
  scope: z.enum(["global", "project"]),
  skillEnvSecretNames: z.record(z.string(), z.string()).optional(),
  skillEnvValues: z.record(z.string(), z.string()).optional(),
  source: installerSourceSchema,
  variableSecretNames: z.record(z.string(), z.string()).optional(),
  variableSubstitutions: z.record(z.string(), z.string()).optional(),
}).strict()

const secretDispatchDataSchema = z.object({
  secret: secretValueViewSchema,
}).strict()

async function resolveInstallerSecretReferences(
  payload: SynapseInstallSourceToEditorPayload,
  deps: {
    auditSink: AuditSink
    permissionGuard: PermissionGuard
    resolveSecretsService: () => SecretsService
  },
): Promise<SynapseInstallSourceToEditorPayload> {
  const {
    skillEnvSecretNames,
    variableSecretNames,
    ...installPayload
  } = payload
  const references = [
    ...Object.entries(skillEnvSecretNames ?? {}),
    ...Object.entries(variableSecretNames ?? {}),
  ]
  if (references.length === 0) return installPayload

  const dispatcher = createSecretsCapabilityDispatcher({
    service: deps.resolveSecretsService(),
    auditSink: deps.auditSink,
    permissionGuard: deps.permissionGuard,
    actor: { kind: "user", id: "installer", display: "Synapse Installer" },
  })
  const resolvedValues = new Map<string, string>()
  for (const secretName of new Set(references.map(([, name]) => name))) {
    const result = await dispatcher.dispatch(
      SECRETS_ITEM_GET_CAPABILITY_ID,
      { name: secretName, includeValue: true },
      { source: "api" },
    )
    if (!result.ok) throw new Error(result.error ?? "读取已保存密钥失败。")
    resolvedValues.set(secretName, secretDispatchDataSchema.parse(result.data).secret.value)
  }

  return {
    ...installPayload,
    skillEnvValues: mergeReferencedValues(
      installPayload.skillEnvValues,
      skillEnvSecretNames,
      resolvedValues,
    ),
    variableSubstitutions: mergeReferencedValues(
      installPayload.variableSubstitutions,
      variableSecretNames,
      resolvedValues,
    ),
  }
}

function mergeReferencedValues(
  values: Record<string, string> | undefined,
  secretNames: Record<string, string> | undefined,
  resolvedValues: ReadonlyMap<string, string>,
): Record<string, string> | undefined {
  if (!secretNames || Object.keys(secretNames).length === 0) return values
  return {
    ...values,
    ...Object.fromEntries(Object.entries(secretNames).map(([name, secretName]) => [
      name,
      requireResolvedSecretValue(resolvedValues, secretName),
    ])),
  }
}

function requireResolvedSecretValue(
  resolvedValues: ReadonlyMap<string, string>,
  secretName: string,
): string {
  const value = resolvedValues.get(secretName)
  if (value === undefined) throw new Error("读取已保存密钥失败。")
  return value
}

const installSourceTargetSchema = z.object({
  editorId: z.string().min(1),
  projectPath: z.string().optional(),
  scope: z.enum(["global", "project"]),
}).strict()

const installSourceToEditorTargetsSchema = z.object({
  mode: z.enum(["install", "reinstall", "update"]),
  overwriteConfirmed: z.boolean().optional(),
  replaceConfirmed: z.boolean().optional(),
  skillEnvValues: z.record(z.string(), z.string()).optional(),
  source: installerSourceSchema,
  targets: z.array(installSourceTargetSchema),
  variableSubstitutions: z.record(z.string(), z.string()).optional(),
}).strict()

export const installersIpcModule: IpcModule = {
  id: "installers",
  methods: {
    inspectGlobalSkillInstallations: {
      kind: "invoke",
      channel: "synapse:installers:inspect-global-skill-installations",
      request: skillInstallerSourceSchema,
      handler: (_ctx, source: SynapseSkillInstallerSource) =>
        editorInstallService.inspectGlobalSkillInstallations(source),
    },
    inspectSkillEnvSource: {
      kind: "invoke",
      channel: "synapse:installers:inspect-skill-env-source",
      request: skillInstallerSourceSchema,
      response: z.object({
        declarations: z.array(z.object({
          name: z.string(),
          defaultValue: z.string(),
        }).strict()),
        legacyPlaceholders: z.array(z.string()),
      }).strict(),
      handler: (_ctx, source: SynapseSkillInstallerSource) =>
        editorInstallService.inspectSkillEnvSource(source),
    },
    prepareLocalSkillSource: {
      kind: "invoke",
      channel: "synapse:installers:prepare-local-skill-source",
      request: prepareLocalSkillSourceSchema,
      response: skillInstallerSourceSchema,
      handler: (_ctx, payload: SynapsePrepareLocalSkillSourcePayload) =>
        installerSourceService.prepareLocalSkillSource(payload),
    },
    prepareInlineRuleSource: {
      kind: "invoke",
      channel: "synapse:installers:prepare-inline-rule-source",
      request: prepareInlineRuleSourceSchema,
      response: ruleInstallerSourceSchema,
      handler: (_ctx, payload: SynapsePrepareInlineRuleSourcePayload) =>
        installerSourceService.prepareInlineRuleSource(payload),
    },
    installSourceToEditor: {
      kind: "invoke",
      channel: "synapse:installers:install-source-to-editor",
      request: installSourceToEditorSchema,
      handler: async (ctx, payload: SynapseInstallSourceToEditorPayload) => {
        const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
        const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
        const resolvedPayload = await resolveInstallerSecretReferences(payload, {
          auditSink,
          permissionGuard,
          resolveSecretsService: () => ctx.resolve<SecretsService>("core.secrets"),
        })
        const result = await editorInstallService.installSourceToEditor(resolvedPayload, {
          actor: { kind: "user" },
          auditSink,
          permissionGuard,
        })

        if (payload.source.origin === "repository" && payload.source.repositoryContentId) {
          const eventBus = ctx.resolve<EventBus>("core.event-bus")
          await notifyInstallStatusChanged(eventBus, payload.source.repositoryContentId, {
            logger,
            warningMessage: "Failed to refresh install status after installer install.",
          })
          if (payload.replacedSourceIdentity && payload.replacedSourceIdentity !== payload.source.repositoryContentId) {
            await notifyInstallStatusChanged(eventBus, payload.replacedSourceIdentity, {
              logger,
              warningMessage: "Failed to refresh install status after installer install.",
            })
          }
        }

        return result
      },
    },
    installSourceToEditorTargets: {
      kind: "invoke",
      channel: "synapse:installers:install-source-to-editor-targets",
      request: installSourceToEditorTargetsSchema,
      handler: async (ctx, payload: SynapseInstallSourceToEditorTargetsPayload) => {
        const result = await editorInstallService.installSourceToEditorTargets(payload, {
          actor: { kind: "user" },
          auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
        })

        const contentId = payload.source.origin === "repository" && payload.source.repositoryContentId
          ? payload.source.repositoryContentId
          : payload.source.sourceIdentity
        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        await notifyInstallStatusChanged(eventBus, contentId, {
          logger,
          warningMessage: "Failed to refresh install status after batch installer install.",
        })

        return result
      },
    },
  },
  events: {},
}
