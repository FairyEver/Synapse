import type {
  SynapseFileConversionFailure,
  SynapseFileConversionSuccess,
} from "@/types/tools"

const SUPPORTED_FILE_EXTENSIONS = [".docx", ".xlsx", ".pdf", ".pptx"] as const

export function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath
}

export function isSupportedConversionFile(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase()
  return SUPPORTED_FILE_EXTENSIONS.some((extension) => lowerPath.endsWith(extension))
}

export function supportedConversionExtensionsLabel(): string {
  return SUPPORTED_FILE_EXTENSIONS.map((extension) => extension.slice(1)).join("、")
}

export function summarizeConversionResult(result: {
  readonly successes: readonly SynapseFileConversionSuccess[]
  readonly failures: readonly SynapseFileConversionFailure[]
}): string {
  if (result.failures.length === 0) {
    return `已转换 ${result.successes.length} 个文件`
  }
  if (result.successes.length === 0) {
    return "转换失败"
  }
  return `已转换 ${result.successes.length} 个文件，${result.failures.length} 个失败`
}
