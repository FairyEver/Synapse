import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"

const BRANCH_ID_RE = /^[a-z][a-z0-9_]*$/

export const switchBranchSchema = z.object({
  id: z.string().regex(BRANCH_ID_RE, "Branch id must match /^[a-z][a-z0-9_]*/"),
  label: z.string().min(1),
})
export const switchNodeConfigSchema = z.object({
  agent: z.string().min(1),
  variables: z.array(variableBindingSchema),
  prompt: z.string(),
  branches: z.array(switchBranchSchema).min(1),
  defaultBranch: z.string().optional(),
}).superRefine((config, ctx) => {
  if (!config.defaultBranch) return
  if (config.branches.some((branch) => branch.id === config.defaultBranch)) return
  ctx.addIssue({
    code: "custom",
    path: ["defaultBranch"],
    message: "默认分支必须属于分支列表",
  })
})
export type SwitchNodeConfig = z.infer<typeof switchNodeConfigSchema>
export type SwitchBranch = z.infer<typeof switchBranchSchema>
