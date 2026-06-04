export function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  return normalized.split("/").pop() || filePath
}

