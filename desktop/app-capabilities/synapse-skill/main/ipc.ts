import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import { SYNAPSE_SKILL_SERVICE_ID } from "../shared/capability"
import { synapseSkillInstallerSourceSchema } from "../shared/schema"
import type { SynapseSkillService } from "./service"

const synapseSkillIpcModule: IpcModule = {
  id: "synapseSkill",
  methods: {
    prepareInstallSource: {
      channel: "synapse:synapse-skill:install-source:prepare",
      kind: "invoke",
      request: z.void().optional(),
      response: synapseSkillInstallerSourceSchema,
      handler: async (ctx) => ctx.resolve<SynapseSkillService>(
        SYNAPSE_SKILL_SERVICE_ID,
      ).prepareInstallSource(),
    },
  },
  events: {},
}

export { synapseSkillIpcModule }
