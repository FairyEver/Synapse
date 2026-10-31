import { describe, expect, it } from "vitest"
import { applySynapseConfigPatch, createDefaultConfig, sanitizeSynapseConfig } from "../config"

describe("建房偏好持久化", () => {
  const preferences = { mode: "practice", variant: "short32", blindPreset: "5/10", maxSeats: 8, buyIn: 2000 }
  it("配置读写保留各账号合法选项，排除名称和无效配置", () => {
    const config = sanitizeSynapseConfig({ ...createDefaultConfig(), global: {
      pokerRoomPreferences: {
        user: { ...preferences, name: "不记住名称" },
        invalid: { ...preferences, maxSeats: 99 },
      },
    } })
    expect(config.global).toHaveProperty("pokerRoomPreferences", { user: preferences })
    expect(applySynapseConfigPatch(config, { global: { themeMode: "dark" } }).global)
      .toHaveProperty("pokerRoomPreferences", { user: preferences })
  })
})
