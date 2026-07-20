import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import { SYNAPSE_SKILL_SERVICE_ID } from "../shared/capability"
import { synapseSkillInstallerSourceSchema } from "../shared/schema"
import type { SynapseSkillService } from "./service"

const synapseSkillIpcModule: IpcModule = {
  id: "synapseSkill",
  methods: {
    prepareInstallSource: {
      operationId: "app.synapse_skill.install_source.prepare",
      kind: "invoke",
      request: z.void().optional(),
      response: synapseSkillInstallerSourceSchema,
      handler: async (ctx) => ctx.resolve<SynapseSkillService>(
        SYNAPSE_SKILL_SERVICE_ID,
      ).prepareInstallSource(),
    },
    releaseInstallSource: {
      operationId: "app.synapse_skill.install_source.release",
      kind: "invoke",
      request: z.object({ preparedSourceId: z.string().min(1) }),
      response: z.void(),
      handler: async (ctx, { preparedSourceId }: { preparedSourceId: string }) => ctx.resolve<SynapseSkillService>(
        SYNAPSE_SKILL_SERVICE_ID,
      ).releaseInstallSource(preparedSourceId),
    },
  },
  events: {},
}

export { synapseSkillIpcModule }
