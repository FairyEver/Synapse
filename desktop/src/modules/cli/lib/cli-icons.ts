import type { SynapseCliId } from "@/types/cli"
import { ideDefinitions } from "@/ide-definitions/generated/renderer-registry"

const cliIconMap = new Map<string, string>(
  ideDefinitions.map((definition) => [definition.id, definition.icon]),
)

const CLI_ICON_CLIP_STYLE: React.CSSProperties = { clipPath: "inset(6%)" }

function getCliIconSrc(cliId: SynapseCliId): string | undefined {
  return cliIconMap.get(cliId)
}

export { CLI_ICON_CLIP_STYLE, getCliIconSrc }
