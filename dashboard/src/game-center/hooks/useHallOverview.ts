import { gameApi } from "../lib/api"
import { useGameQuery } from "./useGameQuery"
export function useHallOverview() {
  return useGameQuery(() => gameApi().hall.overview(), "hall", 1000)
}
