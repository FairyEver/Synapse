function getRepositoryNameFromPath(repositoryPath: string): string {
  const normalizedPath = repositoryPath.replace(/[\\/]+$/, "")
  const segments = normalizedPath.split(/[\\/]/).filter((segment) => segment.length > 0)

  return segments.at(-1) ?? repositoryPath
}

function getProjectNameFromPath(projectPath: string): string {
  const normalizedPath = projectPath.replace(/[\\/]+$/, "")
  const segments = normalizedPath.split(/[\\/]/).filter((segment) => segment.length > 0)

  return segments.at(-1) ?? projectPath
}

export { getRepositoryNameFromPath, getProjectNameFromPath }
