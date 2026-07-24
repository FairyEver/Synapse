import { z } from "zod"
import {
  automationScriptInputBindingSchema,
  workflowScriptInputBindingSchema,
} from "./input"

export const scriptSourceSchema = z.string().max(1024 * 1024)
export const scriptTimeoutSecondsSchema = z.number().int().min(1).max(900).default(60)
export const scriptSaveRunContentSchema = z.boolean().default(true)
export const nodeModuleModeSchema = z.enum(["commonjs", "esm"]).default("commonjs")

export const javascriptWorkflowConfigSchema = z.object({
  source: scriptSourceSchema,
  inputs: z.array(workflowScriptInputBindingSchema).default([]),
  timeoutSeconds: scriptTimeoutSecondsSchema,
  saveRunContent: scriptSaveRunContentSchema,
}).strict()

export const nodejsWorkflowConfigSchema = javascriptWorkflowConfigSchema.extend({
  moduleMode: nodeModuleModeSchema,
  workingDirectory: z.string().optional(),
}).strict()

export const javascriptAutomationConfigSchema = z.object({
  source: scriptSourceSchema,
  inputs: z.array(automationScriptInputBindingSchema).default([]),
  timeoutSeconds: scriptTimeoutSecondsSchema,
  saveRunContent: scriptSaveRunContentSchema,
}).strict()

export const nodejsAutomationConfigSchema = javascriptAutomationConfigSchema.extend({
  moduleMode: nodeModuleModeSchema,
}).strict()

export type JavascriptWorkflowConfig = z.infer<typeof javascriptWorkflowConfigSchema>
export type NodejsWorkflowConfig = z.infer<typeof nodejsWorkflowConfigSchema>
export type JavascriptAutomationConfig = z.infer<typeof javascriptAutomationConfigSchema>
export type NodejsAutomationConfig = z.infer<typeof nodejsAutomationConfigSchema>
