/** @vitest-environment jsdom */
import { afterEach, expect, it } from "vitest"
import { roomPreferencesStore } from "./preferences"

afterEach(() => localStorage.clear())
it.each([7, 8, 9, 10])("旧的%s人配置恢复为6人并保留其他选项", async maxSeats => {
  localStorage.setItem("synapse.game.poker-room-preferences.v1:user", JSON.stringify({
    mode: "practice", variant: "short32", blindPreset: "5/10", maxSeats, buyIn: 2000, roll: true,
  }))
  expect(await roomPreferencesStore.get("user")).toEqual({
    mode: "practice", variant: "short32", blindPreset: "5/10", maxSeats: 6, buyIn: 1000, roll: true, rollCoins: 12,
  })
  expect(await roomPreferencesStore.get("other")).toBeNull()
})

it("remembers custom roll coins by account and rejects invalid saved allowances", async () => {
  const options={mode:"practice" as const,variant:"short32" as const,blindPreset:"5/10" as const,maxSeats:6,buyIn:2000,roll:true,rollCoins:21}
  await roomPreferencesStore.update("coins-user",options)
  expect(await roomPreferencesStore.get("coins-user")).toMatchObject({rollCoins:21})
  expect(await roomPreferencesStore.get("another-user")).toBeNull()
  for (const rollCoins of [0,-1,1.5,2147483648]) {
    localStorage.setItem("synapse.game.poker-room-preferences.v1:bad",JSON.stringify({...options,rollCoins}))
    await expect(roomPreferencesStore.get("bad")).rejects.toThrow()
  }
})

it.each([500, 2000, 1000, 5000, 10000, 50000])("保存金额%s恢复为有效新档位", async buyIn => {
  await roomPreferencesStore.update("user", { mode: "points", variant: "standard52", blindPreset: "1/2", maxSeats: 6, buyIn })
  expect(await roomPreferencesStore.get("user")).toMatchObject({ buyIn: [500, 2000].includes(buyIn) ? 1000 : buyIn })
})
