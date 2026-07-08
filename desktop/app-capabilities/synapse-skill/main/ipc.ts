import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import { synapseSkillInstallerSourceSchema } from "../shared/schema"
import { synapseSkillService } from "./service"

const synapseSkillIpcModule: IpcModule = {
  id: "synapseSkill",
  methods: {
    prepareInstallSource: {
      channel: "synapse:synapse-skill:install-source:prepare",
      kind: "invoke",
      request: z.void().optional(),
      response: synapseSkillInstallerSourceSchema,
      handler: async () => synapseSkillService.prepareInstallSource(),
    },
  },
  events: {},
}

export { synapseSkillIpcModule }
