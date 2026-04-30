import path from "node:path"

type PathAdapter = Pick<typeof path, "isAbsolute" | "relative">

type RepositoryGitPathOptions = {
  readonly pathApi?: PathAdapter
  readonly unique?: boolean
}

function toGitPath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/")
}

function isRepositoryRelativePath(relativePath: string, pathApi: PathAdapter = path): boolean {
  return relativePath.length > 0
    && !relativePath.startsWith("..")
    && !pathApi.isAbsolute(relativePath)
}

function toRepositoryGitPaths(
  gitRootPath: string,
  filePaths: readonly string[],
  options: RepositoryGitPathOptions = {},
): string[] {
  const pathApi = options.pathApi ?? path
  const relativePaths = filePaths
    .map((filePath) => pathApi.relative(gitRootPath, filePath))
    .filter((relativePath) => isRepositoryRelativePath(relativePath, pathApi))
    .map(toGitPath)

  return options.unique ? [...new Set(relativePaths)] : relativePaths
}

export { isRepositoryRelativePath, toGitPath, toRepositoryGitPaths }
export type { PathAdapter, RepositoryGitPathOptions }
