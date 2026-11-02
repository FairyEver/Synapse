/** @vitest-environment jsdom */
import { afterEach, expect, it } from "vitest"
import { roomPreferencesStore } from "./preferences"

afterEach(() => localStorage.clear())
it.each([7, 8, 9, 10])("旧的%s人配置恢复为6人并保留其他选项", async maxSeats => {
  localStorage.setItem("synapse.game.poker-room-preferences.v1:user", JSON.stringify({
    mode: "practice", variant: "short32", blindPreset: "5/10", maxSeats, buyIn: 2000, roll: true,
  }))
  expect(await roomPreferencesStore.get("user")).toEqual({
    mode: "practice", variant: "short32", blindPreset: "5/10", maxSeats: 6, buyIn: 2000, roll: true,
  })
  expect(await roomPreferencesStore.get("other")).toBeNull()
})
