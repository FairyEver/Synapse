import { gameApi } from "../lib/api"
import { useGameQuery } from "./useGameQuery"
export function useHallOverview(enabled = true) {
  return useGameQuery(() => gameApi().hall.overview(), "hall", 1000, enabled)
}
