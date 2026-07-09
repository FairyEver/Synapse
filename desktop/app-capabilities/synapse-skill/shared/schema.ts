import { z } from "zod"

const synapseSkillInstallerSourceSchema = z.object({
  kind: z.literal("skill"),
  origin: z.literal("prepared"),
  sourceIdentity: z.literal("synapse-skill"),
  name: z.literal("synapse-skill"),
  title: z.literal("Synapse Skill"),
  description: z.string(),
  preparedSourceId: z.string().min(1),
  mainContent: z.string(),
  sourceFingerprint: z.string().min(1),
})

type SynapseSkillInstallerSource = z.infer<typeof synapseSkillInstallerSourceSchema>

export {
  synapseSkillInstallerSourceSchema,
  type SynapseSkillInstallerSource,
}
