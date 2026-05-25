import type {
  SynapseFileConversionFailure,
  SynapseFileConversionPayload,
  SynapseFileConversionResult,
  SynapseFileConversionSuccess,
} from "../../../src/types/tools"

export type ToolsFileConversionPayload = SynapseFileConversionPayload
export type ToolsFileConversionResult = SynapseFileConversionResult
export type ToolsFileConversionSuccess = SynapseFileConversionSuccess
export type ToolsFileConversionFailure = SynapseFileConversionFailure

export type ToolsFileConversionWorkerMessage =
  | { readonly type: "success"; readonly result: ToolsFileConversionResult }
  | { readonly type: "error"; readonly error: { readonly name?: string; readonly message?: string; readonly stack?: string } }
