function sanitizeDatabaseLogPath(filePath: string): string {
  const normalized = filePath.trim().replace(/^file:\/\/\/?/, "/").replace(/\\/g, "/")
  const basename = normalized.split("/").filter(Boolean).at(-1)
  return basename ? `[path redacted]/${basename}` : "[path redacted]"
}

export {
  sanitizeDatabaseLogPath,
}
