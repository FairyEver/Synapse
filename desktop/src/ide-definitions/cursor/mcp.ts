import cursorIcon from "../../assets/cursor.png"
import type { SynapseMcpDefinition } from "../types"

export const mcpDefinition = {
  target: "cursor",
  label: "Cursor",
  order: 20,
  icon: cursorIcon,
} as const satisfies SynapseMcpDefinition
