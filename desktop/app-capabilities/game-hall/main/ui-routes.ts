import { pokerUiRoutes } from "../games/poker/main/ui-routes"
export interface GameUiRoute {
  method: "GET" | "POST"
  path: (params: Record<string, unknown>) => string
  bareResponse: boolean
}
// Register game transports here; the account/network service has no game branches.
export const GAME_UI_ROUTES: Readonly<Record<string, GameUiRoute>> = { ...pokerUiRoutes }
