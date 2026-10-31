type CleanupResult = {
  deleted: number
  failures?: number
}

export function getCleanupResultMessage(result: CleanupResult): string {
  if (result.failures && result.failures > 0) {
    return `已清理 ${result.deleted} 个日志文件，${result.failures} 个清理失败`
  }
  return `已清理 ${result.deleted} 个日志文件`
}
