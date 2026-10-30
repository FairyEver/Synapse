export interface GameDefinition {
  id: string
  name: string
  icon: string
  entry: string
  status: "available" | "coming_soon"
}
export const GAME_REGISTRY: readonly GameDefinition[] = [
  { id: "poker", name: "德州扑克", icon: "Spade", entry: "/poker", status: "available" },
]
