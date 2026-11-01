import type { GameFunding, PokerVariant, PokerBlindPreset } from "@synapse/shared/game-contracts"
export type PokerRoomPreferences = { mode: GameFunding; variant: PokerVariant; blindPreset: PokerBlindPreset; maxSeats: number; buyIn: number; roll?: boolean }
const key = (userId: string) => `synapse.game.poker-room-preferences.v1:${userId}`
export const roomPreferencesStore = {
  async get(userId: string): Promise<PokerRoomPreferences | null> {
    const raw = localStorage.getItem(key(userId))
    if (!raw) return null
    const value = JSON.parse(raw) as PokerRoomPreferences
    if (value.roll != null && typeof value.roll !== "boolean" || !["points", "practice"].includes(value.mode) || !["standard52", "short32"].includes(value.variant)
      || !["1/2", "2/4", "5/10", "10/20"].includes(value.blindPreset) || !Number.isInteger(value.maxSeats)
      || value.maxSeats < 2 || value.maxSeats > 10 || ![500, 1000, 2000, 5000].includes(value.buyIn)) {
      throw new Error("房间配置无效，请重置浏览器保存的房间选项。")
    }
    return { mode:value.mode, variant:value.variant, blindPreset:value.blindPreset, maxSeats:value.maxSeats, buyIn:value.buyIn, roll:value.roll ?? false }
  },
  async update(userId: string, value: PokerRoomPreferences): Promise<void> {
    localStorage.setItem(key(userId), JSON.stringify({ mode:value.mode, variant:value.variant, blindPreset:value.blindPreset, maxSeats:value.maxSeats, buyIn:value.buyIn, roll:value.roll ?? false }))
  },
}
