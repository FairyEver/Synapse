import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type {
  SynapsePrepareInlineRuleSourcePayload,
  SynapsePrepareLocalSkillSourcePayload,
} from "../../../src/types/installers"
import { installerSourceService } from "../../services/installer-source-service"

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
  },
  events: {},
}
