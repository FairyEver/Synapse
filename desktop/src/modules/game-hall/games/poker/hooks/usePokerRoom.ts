import { useState } from "react"
import { gameApi } from "../../../lib/api"
import { useGameQuery } from "../../../hooks/useGameQuery"
import { projectTable } from "../lib/view"
export function usePokerRoom(roomCode: string) {
  const [perspective, setPerspective] = useState<"owner" | "public">("owner")
  const query = useGameQuery(
    () => gameApi().poker.table.state({ roomCode, perspective }),
    `room:${roomCode}:${perspective}`,
    1000,
  )
  const table = query.data ? projectTable(query.data, perspective) : null
  return { ...query, table, perspective, setPerspective }
}
