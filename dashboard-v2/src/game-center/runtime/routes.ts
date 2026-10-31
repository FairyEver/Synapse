export type GameRoute = { entry: string | null; roomCode: string | null; tab: "rooms" | "records" | "agents" }

export function parseGamePath(path: string): GameRoute | null {
  if (path === "/game/" || path === "/game") return { entry: null, roomCode: null, tab: "rooms" }
  if (path === "/game/poker" || path === "/game/poker/") return { entry: "/poker", roomCode: null, tab: "rooms" }
  const match = /^\/game\/poker\/(records|agents|\d{4,6})$/.exec(path)
  if (!match) return null
  return { entry: "/poker", roomCode: /^\d/.test(match[1]) ? match[1] : null,
    tab: match[1] === "records" || match[1] === "agents" ? match[1] : "rooms" }
}

export function gamePath(route: GameRoute): string {
  if (!route.entry) return "/game/"
  return `/game${route.entry}${route.roomCode ? `/${route.roomCode}` : route.tab !== "rooms" ? `/${route.tab}` : ""}`
}

export function isGameRedirect(value: string | undefined): boolean {
  if (!value || value.includes("\\") || !value.startsWith("/game")) return false
  return parseGamePath(value.split(/[?#]/, 1)[0]) !== null
}
