import type { PermissionAction } from "../../runtime/security"
import type { z } from "zod"

export type BuiltinToolId =
  | "docx-to-markdown"
  | "xlsx-to-markdown"
  | "csv-to-markdown"
  | "pdf-to-markdown"
  | "pptx-to-markdown"

export type BuiltinToolCategory = "conversion" | "content" | "utility"
export type BuiltinToolEntryPoint = "tools" | "workflow" | "automation" | "knowledge-base"
export type BuiltinToolOutputKind = "markdown" | "text" | "file"

export interface BuiltinToolFieldCondition {
  readonly field: string
  readonly equals: string | number | boolean
}

export type BuiltinToolInputField =
  | {
      readonly id: string
      readonly kind: "file"
      readonly label: string
      readonly required?: boolean
      readonly extensions?: readonly string[]
    }
  | {
      readonly id: string
      readonly kind: "directory"
      readonly label: string
      readonly required?: boolean
      readonly when?: BuiltinToolFieldCondition
    }
  | {
      readonly id: string
      readonly kind: "text"
      readonly label: string
      readonly required?: boolean
      readonly defaultValue?: string
      readonly when?: BuiltinToolFieldCondition
    }
  | {
      readonly id: string
      readonly kind: "select"
      readonly label: string
      readonly required?: boolean
      readonly defaultValue?: string
      readonly options: readonly { readonly value: string; readonly label: string }[]
      readonly when?: BuiltinToolFieldCondition
    }
  | {
      readonly id: string
      readonly kind: "checkbox"
      readonly label: string
      readonly defaultValue?: boolean
      readonly when?: BuiltinToolFieldCondition
    }
  | {
      readonly id: string
      readonly kind: "number"
      readonly label: string
      readonly required?: boolean
      readonly defaultValue?: number
      readonly min?: number
      readonly max?: number
      readonly when?: BuiltinToolFieldCondition
    }

export interface BuiltinToolUiDescriptor {
  readonly fields: readonly BuiltinToolInputField[]
  readonly resultPreview: BuiltinToolOutputPreviewDescriptor
}

export interface BuiltinToolOutputPreviewDescriptor {
  readonly kind: BuiltinToolOutputKind
  readonly pathFromOutput?: string
}

export interface BuiltinToolPermissionRequirement {
  readonly action: PermissionAction
  readonly pathFromInput: string
  readonly when?: Record<string, string | number | boolean>
}

export interface BuiltinToolInputDescriptor {
  readonly kind: "file"
  readonly extensions: readonly string[]
}

export interface BuiltinToolOutputDescriptor {
  readonly kind: BuiltinToolOutputKind
}

export interface BuiltinToolExecutionContext {
  readonly entryPoint: BuiltinToolEntryPoint
  readonly actor: { readonly kind: "user" } | { readonly kind: "system"; readonly id?: string }
  readonly runId?: string
  readonly abortSignal?: AbortSignal
}

export type BuiltinToolExecutor<Input, Output> = (
  input: Input,
  context: BuiltinToolExecutionContext,
) => Promise<Output>

export interface BuiltinToolDescriptor<Input = unknown, Output = unknown> {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly category: BuiltinToolCategory
  readonly inputSchema: z.ZodType<Input>
  readonly outputSchema: z.ZodType<Output>
  readonly ui: BuiltinToolUiDescriptor
  readonly permissions: readonly BuiltinToolPermissionRequirement[]
  readonly entryPoints: readonly BuiltinToolEntryPoint[]
  readonly input: BuiltinToolInputDescriptor
  readonly output: BuiltinToolOutputDescriptor
  readonly executor: BuiltinToolExecutor<Input, Output>
}

export interface RendererBuiltinToolDescriptor {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly category: BuiltinToolCategory
  readonly inputFields: readonly BuiltinToolInputField[]
  readonly outputPreview: BuiltinToolOutputPreviewDescriptor
  readonly input: BuiltinToolInputDescriptor
  readonly output: BuiltinToolOutputDescriptor
}

export interface BuiltinToolWarning {
  readonly code: string
  readonly message: string
}

export interface BuiltinToolErrorPayload {
  readonly code: BuiltinToolErrorCode
  readonly message: string
}

export type BuiltinToolErrorCode =
  | "unknown_tool"
  | "invalid_input"
  | "permission_denied"
  | "unsupported_input"
  | "read_failed"
  | "conversion_failed"
  | "write_failed"
  | "worker_failed"
  | "timeout"

export type BuiltinToolRunResult<Output = unknown> =
  | {
      readonly ok: true
      readonly toolId: string
      readonly output: Output
      readonly warnings: readonly BuiltinToolWarning[]
      readonly metadata: Record<string, unknown>
    }
  | {
      readonly ok: false
      readonly toolId: string
      readonly error: BuiltinToolErrorPayload
      readonly metadata: Record<string, unknown>
    }

