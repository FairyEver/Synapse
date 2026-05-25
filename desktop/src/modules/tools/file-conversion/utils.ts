import type {
  SynapseFileConversionFailure,
  SynapseFileConversionSuccess,
} from "@/types/tools"

export function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath
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
