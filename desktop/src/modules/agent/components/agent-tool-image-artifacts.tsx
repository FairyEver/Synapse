import type { SynapseAgentImageArtifact } from "@/types/agent"

const AGENT_ARTIFACT_PROTOCOL_PREFIX = "synapse-agent-artifact://local/"
const LEGACY_AGENT_ARTIFACT_PATH_MARKER = "/agent-artifacts/"

interface AgentToolImageArtifactsProps {
  readonly toolName: string
  readonly artifacts: readonly SynapseAgentImageArtifact[]
}

function AgentToolImageArtifacts({ toolName, artifacts }: AgentToolImageArtifactsProps) {
  if (artifacts.length === 0) return null
  return (
    <div className="grid max-w-full grid-cols-2 gap-2 sm:grid-cols-3">
      {artifacts.map((artifact, index) => {
        const imageUrl = displayableImageUrl(artifact.url)
        return (
          <a
            key={artifact.id}
            href={imageUrl}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded border border-border bg-muted/30"
          >
            <img
              src={imageUrl}
              alt={`${toolName} image ${index + 1}`}
              className="aspect-video h-auto w-full object-contain"
              loading="lazy"
            />
          </a>
        )
      })}
    </div>
  )
}

function displayableImageUrl(url: string): string {
  const value = url.trim()
  if (!value) return value
  const artifactUrl = legacyAgentArtifactUrl(value)
  if (artifactUrl) return artifactUrl
  if (isRenderableUrl(value)) return value
  if (!isAbsoluteFilePath(value)) return value
  return fileUrlFromPath(value)
}

function isRenderableUrl(value: string): boolean {
  return value.startsWith(AGENT_ARTIFACT_PROTOCOL_PREFIX)
    || /^(?:https?|data|blob|file):/i.test(value)
}

function legacyAgentArtifactUrl(value: string): string | undefined {
  const normalized = value.replaceAll("\\", "/")
  const markerIndex = normalized.indexOf(LEGACY_AGENT_ARTIFACT_PATH_MARKER)
  if (markerIndex === -1) return undefined
  const relativePath = normalized.slice(markerIndex + LEGACY_AGENT_ARTIFACT_PATH_MARKER.length)
  const segments = relativePath.split("/").filter(isSafeArtifactUrlSegment)
  if (segments.length < 3) return undefined
  return `${AGENT_ARTIFACT_PROTOCOL_PREFIX}${segments.map(encodeURIComponent).join("/")}`
}

function isSafeArtifactUrlSegment(value: string): boolean {
  return Boolean(value)
    && value !== "."
    && value !== ".."
    && !value.includes("/")
    && !value.includes("\\")
}

function isAbsoluteFilePath(value: string): boolean {
  return value.startsWith("/")
    || /^[A-Za-z]:[\\/]/.test(value)
    || /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(value)
}

function fileUrlFromPath(value: string): string {
  const normalized = value.replaceAll("\\", "/")
  if (normalized.startsWith("//")) {
    return `file://${normalized.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")}`
  }
  const drive = normalized.match(/^[A-Za-z]:\//)?.[0].slice(0, 2)
  if (drive) {
    const rest = normalized.slice(2).split("/").map(encodeURIComponent).join("/")
    return `file:///${drive}${rest}`
  }
  return `file://${normalized.split("/").map(encodeURIComponent).join("/")}`
}

export { AgentToolImageArtifacts }
