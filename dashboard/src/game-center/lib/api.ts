import type { GameBridge } from "@synapse/shared/game-ui"
import { GameWebClient } from "../runtime/web-client"
import { getGameIdentity, invalidateGameSession, onGameIdentityChange } from "../runtime/account"
let client: GameWebClient | undefined
function getClient() {
  if (!client) {
    client = new GameWebClient({ getIdentity: getGameIdentity, onSessionInvalid: invalidateGameSession })
    onGameIdentityChange(() => client?.identityChanged())
  }
  return client
}
function call<T>(operation: string, params: object = {}): Promise<T> {
  return getClient().call(operation, params as Record<string, unknown>) as Promise<T>
}
const bridge: GameBridge = {
  hall: {
    overview: () => call("app.game.hall.overview"), guide: () => call("app.game.hall.guide"),
    account: input => call("app.game.hall.account", input),
  },
  poker: {
    guide: () => call("app.game.poker.guide"),
    lobby: { list: input => call("app.game.poker.lobby.list", input) },
    room: { close: input => call("app.game.poker.room.close", input), create: input => call("app.game.poker.room.create", input), get: input => call("app.game.poker.room.get", input) },
    bot: { add: input => call("app.game.poker.bot.add", input), remove: input => call("app.game.poker.bot.remove", input) },
    seat: { join: input => call("app.game.poker.seat.join", input), leave: input => call("app.game.poker.seat.leave", input), sit: input => call("app.game.poker.seat.sit", input), nudge: input => call("app.game.poker.seat.nudge", input) },
    control: { set: input => call("app.game.poker.control.set", input) },
    action: { act: input => call("app.game.poker.action.act", input) },
    table: { state: input => call("app.game.poker.table.state", input), events: input => call("app.game.poker.table.events", input) },
    agent: { list: () => call("app.game.poker.agent.list"), upsert: input => call("app.game.poker.agent.upsert", input), versions: input => call("app.game.poker.agent.versions", input) },
    hand: { history: input => call("app.game.poker.hand.history", input), detail: input => call("app.game.poker.hand.detail", input) },
    stats: { get: input => call("app.game.poker.stats.get", input) },
  },
}
export function gameApi(): GameBridge { return bridge }
