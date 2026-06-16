import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"

export const claudeCodePermissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
])
export const claudeCodeOutputFormatSchema = z.enum(["text", "json", "stream-json"])
export const claudeCodeSettingSourceSchema = z.enum(["user", "project", "local"])

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

export const claudeCodeNodeConfigSchema = z
  .object({
    variables: z.array(variableBindingSchema),
    prompt: z.string().trim().min(1, "指令不能为空"),
    projectId: optionalTrimmedStringSchema,
    workingDirectory: optionalTrimmedStringSchema,
    timeoutMins: z.number().int().min(1).optional(),
    permissionMode: claudeCodePermissionModeSchema,
    model: optionalTrimmedStringSchema,
    maxTurns: z.number().int().min(1).optional(),
    outputFormat: claudeCodeOutputFormatSchema,
    verbose: z.boolean(),
    safeMode: z.boolean(),
    bareMode: z.boolean(),
    noSessionPersistence: z.boolean(),
    settingSources: z.array(claudeCodeSettingSourceSchema),
    settingsPath: optionalTrimmedStringSchema,
    mcpConfigPath: optionalTrimmedStringSchema,
    strictMcpConfig: z.boolean(),
    additionalDirectories: z.array(nonEmptyTrimmedStringSchema),
    allowedTools: z.array(nonEmptyTrimmedStringSchema),
    disallowedTools: z.array(nonEmptyTrimmedStringSchema),
    captureDebugArtifacts: z.boolean(),
  })
  .superRefine((config, ctx) => {
    const seenSources = new Set<string>()
    config.settingSources.forEach((source, index) => {
      if (seenSources.has(source)) {
        ctx.addIssue({
          code: "custom",
          path: ["settingSources", index],
          message: "设置来源不能重复",
        })
      }
      seenSources.add(source)
    })
  })

export type ClaudeCodeNodeConfig = z.infer<typeof claudeCodeNodeConfigSchema>
export type ClaudeCodePermissionMode = z.infer<typeof claudeCodePermissionModeSchema>
export type ClaudeCodeOutputFormat = z.infer<typeof claudeCodeOutputFormatSchema>
export type ClaudeCodeSettingSource = z.infer<typeof claudeCodeSettingSourceSchema>

export const defaultClaudeCodeNodeConfig: ClaudeCodeNodeConfig = {
  variables: [],
  prompt: "",
  permissionMode: "acceptEdits",
  outputFormat: "stream-json",
  verbose: true,
  safeMode: false,
  bareMode: false,
  noSessionPersistence: false,
  settingSources: ["user", "project", "local"],
  strictMcpConfig: false,
  additionalDirectories: [],
  allowedTools: [],
  disallowedTools: [],
  captureDebugArtifacts: true,
}
