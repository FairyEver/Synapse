export type SynapseToolId = "file-conversion"

export type SynapseToolDefinition = {
  readonly id: SynapseToolId
  readonly label: string
  readonly windowTitle: string
  readonly description: string
  readonly supportedExtensions?: readonly string[]
  readonly bounds: {
    readonly width: number
    readonly height: number
    readonly minWidth: number
    readonly minHeight: number
  }
}

export type SynapseToolsListResult = {
  readonly tools: readonly SynapseToolDefinition[]
}

export type SynapseToolOpenPayload = {
  readonly toolId: SynapseToolId
}

export type SynapseFileConversionFailureReason =
  | "unsupported-format"
  | "read-failed"
  | "conversion-failed"
  | "write-failed"
  | "invalid-output-path"

export type SynapseFileConversionPayload = {
  readonly filePaths: readonly string[]
  readonly outputDirectory: string
}

export type SynapseFileConversionSuccess = {
  readonly sourcePath: string
  readonly outputPath: string
  readonly warningCount: number
}

export type SynapseFileConversionFailure = {
  readonly sourcePath: string
  readonly reason: SynapseFileConversionFailureReason
  readonly message: string
}

export type SynapseFileConversionResult = {
  readonly successes: readonly SynapseFileConversionSuccess[]
  readonly failures: readonly SynapseFileConversionFailure[]
}

export type SynapseFileConversionInputSelectionResult = {
  readonly filePaths: readonly string[]
}

export type SynapseFileConversionOutputDirectoryResult = {
  readonly directoryPath: string | null
}
