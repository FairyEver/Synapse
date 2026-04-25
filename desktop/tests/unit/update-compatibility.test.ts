import { describe, expect, it } from "vitest"
import {
  createLegacyUpdateCompatibility,
  isLegacyUpdateNewer,
} from "../../electron/services/update-compatibility"

describe("legacy update compatibility", () => {
  it("matches CC Connect version comparison cases", () => {
    expect(isLegacyUpdateNewer("v1.2.3", "v1.2.2")).toBe(true)
    expect(isLegacyUpdateNewer("v1.2.2", "v1.2.3")).toBe(false)
    expect(isLegacyUpdateNewer("v1.2.3", "v1.2.3")).toBe(false)
    expect(isLegacyUpdateNewer("v1.2.3", "v1.2.3-beta.1")).toBe(true)
    expect(isLegacyUpdateNewer("v1.2.3-beta.1", "v1.2.3")).toBe(false)
    expect(isLegacyUpdateNewer("v1.2.3-beta.10", "v1.2.3-beta.2")).toBe(true)
    expect(isLegacyUpdateNewer("v1.2.3-rc.1", "v1.2.3-beta.9")).toBe(true)
    expect(isLegacyUpdateNewer("v1.0.0", "dev")).toBe(true)
    expect(isLegacyUpdateNewer("", "v1.0.0")).toBe(false)
    expect(isLegacyUpdateNewer("v1.0.0", "")).toBe(false)
  })

  it("creates nonblocking unknown state before latest version is fetched", () => {
    expect(createLegacyUpdateCompatibility({
      currentVersion: "v1.0.0",
      latestVersion: null,
    })).toEqual({
      status: "unknown",
      currentVersion: "v1.0.0",
      latestVersion: null,
      commandHint: null,
      message: "尚未获取最新版本。",
    })
  })

  it("skips dev versions like CC Connect checkUpdateAsync", () => {
    expect(createLegacyUpdateCompatibility({
      currentVersion: "dev",
      latestVersion: "v2.0.0",
    })).toMatchObject({
      status: "skipped",
      commandHint: null,
      message: "开发版本不检查更新。",
    })
  })

  it("returns the CC Connect command hint for available updates", () => {
    expect(createLegacyUpdateCompatibility({
      currentVersion: "v1.0.0",
      latestVersion: "v2.0.0",
      includePrerelease: true,
    })).toMatchObject({
      status: "available",
      commandHint: "cc-connect update --pre",
      message: "发现新版本 v2.0.0。",
    })
  })
})
