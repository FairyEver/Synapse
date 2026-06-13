import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"

export const codexApprovalPolicySchema = z.enum(["never", "on-request", "untrusted"])
export const codexSandboxSchema = z.enum(["read-only", "workspace-write", "danger-full-access"])
export const codexFeatureStateSchema = z.enum(["default", "enabled", "disabled"])

const nonEmptyTrimmedStringSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1))

const optionalTrimmedStringSchema = z
  .string()
  .transform((value) => {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  })
  .optional()

export const codexConfigOverrideSchema = z.object({
  key: nonEmptyTrimmedStringSchema,
  value: z.string(),
})

export const codexNodeConfigSchema = z
  .object({
    variables: z.array(variableBindingSchema),
    prompt: z.string().trim().min(1, "指令不能为空"),
    workingDirectoryTemplate: optionalTrimmedStringSchema,
    projectId: z.string().optional(),
    timeoutMins: z.number().int().min(1).optional(),
    approvalPolicy: codexApprovalPolicySchema,
    sandbox: codexSandboxSchema,
    model: optionalTrimmedStringSchema,
    profile: optionalTrimmedStringSchema,
    enableSearch: z.boolean(),
    features: z.object({
      goals: codexFeatureStateSchema,
    }),
    skipGitRepoCheck: z.boolean(),
    strictConfig: z.boolean(),
    bypassApprovalsAndSandbox: z.boolean(),
    bypassHookTrust: z.boolean(),
    additionalWritableDirs: z.array(nonEmptyTrimmedStringSchema),
    images: z.array(nonEmptyTrimmedStringSchema),
    configOverrides: z.array(codexConfigOverrideSchema),
    captureDebugArtifacts: z.boolean(),
  })
  .superRefine((config, ctx) => {
    const seenKeys = new Set<string>()

    config.configOverrides.forEach((override, index) => {
      if (seenKeys.has(override.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["configOverrides", index, "key"],
          message: "配置覆盖项 key 不能重复",
        })
      }

      seenKeys.add(override.key)
    })
  })

export type CodexNodeConfig = z.infer<typeof codexNodeConfigSchema>
export type CodexApprovalPolicy = z.infer<typeof codexApprovalPolicySchema>
export type CodexSandbox = z.infer<typeof codexSandboxSchema>
export type CodexFeatureState = z.infer<typeof codexFeatureStateSchema>

export const defaultCodexNodeConfig: CodexNodeConfig = {
  variables: [],
  prompt: "",
  workingDirectoryTemplate: undefined,
  approvalPolicy: "never",
  sandbox: "workspace-write",
  enableSearch: false,
  features: { goals: "enabled" },
  skipGitRepoCheck: true,
  strictConfig: false,
  bypassApprovalsAndSandbox: false,
  bypassHookTrust: false,
  additionalWritableDirs: [],
  images: [],
  configOverrides: [],
  captureDebugArtifacts: true,
}
