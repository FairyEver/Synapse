import type { GameUiRoute } from "../../../main/ui-routes"
export const pokerUiRoutes = {
  "app.game.poker.table.state": {
    method: "GET",
    bareResponse: true,
    path: (params) =>
      `/game/poker/rooms/${encodeURIComponent(String(params.roomCode))}/state?perspective=${params.perspective === "public" ? "public" : "owner"}`,
  },
  "app.game.poker.room.close": {
    method: "POST",
    bareResponse: true,
    path: (params) => `/game/poker/rooms/${encodeURIComponent(String(params.roomCode))}/close`,
  },
} satisfies Record<string, GameUiRoute>
