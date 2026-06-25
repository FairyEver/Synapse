import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type {
  SynapseInstallSourceToEditorPayload,
  SynapsePrepareInlineRuleSourcePayload,
  SynapsePrepareLocalSkillSourcePayload,
} from "../../../src/types/installers"
import type { EventBus } from "../../runtime/event-bus"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { contentInstallService } from "../../services/content-install-service"
import { installerSourceService } from "../../services/installer-source-service"
import { installStatusCacheService } from "../../services/install-status-cache-service"
import { createMainLogger } from "../../services/log-store"

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
  source: installerSourceSchema,
  variableSubstitutions: z.record(z.string(), z.string()).optional(),
}).strict()

async function notifyInstallStatusChanged(
  eventBus: EventBus,
  contentId: string,
): Promise<void> {
  try {
    const entries = await installStatusCacheService.refresh(contentId)
    eventBus.emit({
      domain: "install-status",
      type: "install-status.changed",
      payload: { contentId, entries },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    logger.warn("Failed to refresh install status after installer install.", { contentId, error })
  }
}

export const installersIpcModule: IpcModule = {
  id: "installers",
  methods: {
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
        const result = await contentInstallService.installSourceToEditor(payload, {
          actor: { kind: "user" },
          auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
        })

        if (payload.source.origin === "repository" && payload.source.repositoryContentId) {
          const eventBus = ctx.resolve<EventBus>("core.event-bus")
          await notifyInstallStatusChanged(eventBus, payload.source.repositoryContentId)
          if (payload.replacedSourceIdentity && payload.replacedSourceIdentity !== payload.source.repositoryContentId) {
            await notifyInstallStatusChanged(eventBus, payload.replacedSourceIdentity)
          }
        }

        return result
      },
    },
  },
  events: {},
}
