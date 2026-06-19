import path from "node:path"

type RepositoryPathOptions = {
  readonly platform?: NodeJS.Platform | string
}

function pathForPlatform(platform: NodeJS.Platform | string) {
  return platform === "win32" ? path.win32 : path
}

export function normalizeRepositoryPath(localPath: string, options: RepositoryPathOptions = {}): string {
  const platform = options.platform ?? process.platform
  return pathForPlatform(platform).resolve(localPath)
}

export function normalizeRepositoryPathForCompare(localPath: string, options: RepositoryPathOptions = {}): string {
  const platform = options.platform ?? process.platform
  const normalized = normalizeRepositoryPath(localPath, { platform }).replace(/[\\/]+$/u, "")
  return platform === "win32" ? normalized.replace(/\//gu, "\\").toLowerCase() : normalized
}

export function assertRepositoryPath(repositoryPath: string, relativePath: string): string {
  const root = normalizeRepositoryPath(repositoryPath)
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("文件不在当前仓库内。")
  }
  return resolved
}
