import path from "node:path"

export const AGENT_ARTIFACT_PROTOCOL_SCHEME = "synapse-agent-artifact"
export const AGENT_ARTIFACT_PROTOCOL_HOST = "local"

function agentArtifactUrlForRelativePath(relativePath: string): string {
  const segments = normalizedRelativePathSegments(relativePath)
  return `${AGENT_ARTIFACT_PROTOCOL_SCHEME}://${AGENT_ARTIFACT_PROTOCOL_HOST}/${segments.map(encodeURIComponent).join("/")}`
}

function agentArtifactUrlForStoragePath(rootDirectory: string, storagePath: string): string | undefined {
  const relativePath = safeRelativePath(rootDirectory, storagePath)
  return relativePath ? agentArtifactUrlForRelativePath(relativePath) : undefined
}

function resolveAgentArtifactUrlPath(rootDirectory: string, url: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== `${AGENT_ARTIFACT_PROTOCOL_SCHEME}:`) return undefined
  if (parsed.hostname !== AGENT_ARTIFACT_PROTOCOL_HOST) return undefined

  const segments = parsed.pathname.split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return undefined
      }
    })
  if (segments.length < 3 || segments.some((segment) => !isSafePathSegment(segment))) return undefined

  const targetPath = path.join(path.resolve(rootDirectory), ...(segments as string[]))
  return safeRelativePath(rootDirectory, targetPath) ? targetPath : undefined
}

function normalizedRelativePathSegments(relativePath: string): string[] {
  return relativePath
    .replaceAll("\\", "/")
    .split("/")
    .filter(isSafePathSegment)
}

function isSafePathSegment(value: string | undefined): value is string {
  return typeof value === "string"
    && value.length > 0
    && value !== "."
    && value !== ".."
    && !value.includes("/")
    && !value.includes("\\")
}

function safeRelativePath(rootDirectory: string, targetPath: string): string | undefined {
  const relativePath = path.relative(path.resolve(rootDirectory), path.resolve(targetPath))
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) return undefined
  return relativePath
}

export {
  agentArtifactUrlForRelativePath,
  agentArtifactUrlForStoragePath,
  resolveAgentArtifactUrlPath,
}
