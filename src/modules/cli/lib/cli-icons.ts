import ccIcon from "@/assets/cc.png"
import codexIcon from "@/assets/codex.png"
import type { SynapseCliId } from "@/types/cli"

const cliIconMap: Record<SynapseCliId, string> = {
  "claude-code": ccIcon,
  codex: codexIcon,
}

const CLI_ICON_CLIP_STYLE: React.CSSProperties = { clipPath: "inset(6%)" }

function getCliIconSrc(cliId: SynapseCliId): string | undefined {
  return cliIconMap[cliId]
}

export { CLI_ICON_CLIP_STYLE, getCliIconSrc }
