import path from "node:path"

export function normalizeRepositoryPath(localPath: string): string {
  return path.resolve(localPath)
}

export function assertRepositoryPath(repositoryPath: string, relativePath: string): string {
  const root = normalizeRepositoryPath(repositoryPath)
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("文件不在当前仓库内。")
  }
  return resolved
}
