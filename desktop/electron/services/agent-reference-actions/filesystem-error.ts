const EXPECTED_FILESYSTEM_UNAVAILABLE_CODES = new Set([
  "EACCES",
  "ELOOP",
  "ENOENT",
  "ENOTDIR",
  "EPERM",
  "ESTALE",
])

export function isExpectedFilesystemUnavailableError(
  error: unknown,
): error is NodeJS.ErrnoException {
  if (!(error instanceof Error)) return false
  const code = (error as NodeJS.ErrnoException).code
  return typeof code === "string" && EXPECTED_FILESYSTEM_UNAVAILABLE_CODES.has(code)
}
