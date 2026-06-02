type UsageRefreshFailureCount = {
  readonly failedFiles: number
}

function getUsageRefreshWarning(result: UsageRefreshFailureCount): string | null {
  if (result.failedFiles <= 0) return null
  return `刷新完成，${result.failedFiles} 个文件处理失败，报告可能不完整。`
}

export { getUsageRefreshWarning }
