export type SynapseToolId =
  | "docx-to-markdown"
  | "xlsx-to-markdown"
  | "csv-to-markdown"
  | "pdf-to-markdown"
  | "pptx-to-markdown"

export type SynapseToolCategory = "conversion" | "content" | "utility"
export type SynapseToolOutputKind = "markdown" | "text" | "file"

export interface SynapseToolFieldCondition {
  readonly field: string
  readonly equals: string | number | boolean
}

export type SynapseToolInputField =
  | { readonly id: string; readonly kind: "file"; readonly label: string; readonly required?: boolean; readonly extensions?: readonly string[] }
  | { readonly id: string; readonly kind: "directory"; readonly label: string; readonly required?: boolean; readonly when?: SynapseToolFieldCondition }
  | { readonly id: string; readonly kind: "text"; readonly label: string; readonly required?: boolean; readonly defaultValue?: string; readonly when?: SynapseToolFieldCondition }
  | { readonly id: string; readonly kind: "select"; readonly label: string; readonly required?: boolean; readonly defaultValue?: string; readonly options: readonly { readonly value: string; readonly label: string }[]; readonly when?: SynapseToolFieldCondition }
  | { readonly id: string; readonly kind: "checkbox"; readonly label: string; readonly required?: boolean; readonly defaultValue?: boolean; readonly when?: SynapseToolFieldCondition }
  | { readonly id: string; readonly kind: "number"; readonly label: string; readonly required?: boolean; readonly defaultValue?: number; readonly min?: number; readonly max?: number; readonly when?: SynapseToolFieldCondition }

export interface SynapseToolOutputPreviewDescriptor {
  readonly kind: SynapseToolOutputKind
  readonly pathFromOutput?: string
}

export interface SynapseToolDefinition {
  readonly id: SynapseToolId
  readonly title: string
  readonly description: string
  readonly category: SynapseToolCategory
  readonly inputFields: readonly SynapseToolInputField[]
  readonly outputPreview: SynapseToolOutputPreviewDescriptor
  readonly input: { readonly kind: "file"; readonly extensions: readonly string[] }
  readonly output: { readonly kind: SynapseToolOutputKind }
}

export interface SynapseToolsListResult {
  readonly tools: readonly SynapseToolDefinition[]
}

export interface SynapseToolOpenPayload {
  readonly toolId: SynapseToolId
}

export interface SynapseToolRunPayload {
  readonly toolId: SynapseToolId
  readonly input: Record<string, unknown>
}

export type SynapseToolRunResult =
  | {
      readonly ok: true
      readonly toolId: SynapseToolId
      readonly output: Record<string, unknown>
      readonly warnings: readonly { readonly code: string; readonly message: string }[]
      readonly metadata: Record<string, unknown>
    }
  | {
      readonly ok: false
      readonly toolId: SynapseToolId
      readonly error: { readonly code: string; readonly message: string }
      readonly metadata: Record<string, unknown>
    }

export interface SynapseToolFileSelectionPayload {
  readonly toolId: SynapseToolId
  readonly fieldId: string
}

export interface SynapseToolFileSelectionResult {
  readonly filePath: string | null
}

export interface SynapseToolDirectorySelectionPayload {
  readonly toolId: SynapseToolId
  readonly fieldId: string
  readonly defaultPath?: string
}

export interface SynapseToolDirectorySelectionResult {
  readonly directoryPath: string | null
}
