import type { GameUiRoute } from "../../../main/ui-routes"
const roomPath = (params: Record<string, unknown>) => `/game/poker/rooms/${encodeURIComponent(String(params.roomCode))}`
export const pokerUiRoutes = {
  "app.game.poker.seat.join": {
    method: "POST",
    bareResponse: true,
    path: (params) => `${roomPath(params)}/join`,
  },
  "app.game.poker.action.act": {
    method: "POST",
    bareResponse: true,
    path: (params) => `${roomPath(params)}/actions`,
  },
  "app.game.poker.seat.sit": {
    method: "POST",
    bareResponse: true,
    path: (params) => `${roomPath(params)}/sit`,
  },
  "app.game.poker.seat.leave": {
    method: "POST",
    bareResponse: true,
    path: (params) => `${roomPath(params)}/leave`,
  },
  "app.game.poker.control.set": {
    method: "POST",
    bareResponse: true,
    path: (params) => `${roomPath(params)}/control`,
  },
  "app.game.poker.table.events": {
    method: "GET",
    bareResponse: true,
    path: (params) => {
      const query = new URLSearchParams()
      if (typeof params.cursor === "string") query.set("cursor", params.cursor)
      if (typeof params.limit === "number") query.set("limit", String(params.limit))
      query.set("perspective", params.perspective === "owner" ? "owner" : "public")
      return `${roomPath(params)}/events${query.size ? `?${query}` : ""}`
    },
  },
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
