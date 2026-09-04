/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest"
import {
  acknowledgeRequestedSettingsCategory,
  readRequestedSettingsCategory,
  requestOpenSettingsAbout,
  requestOpenSettingsDock,
} from "../navigation"

afterEach(() => {
  const requestedCategory = readRequestedSettingsCategory()
  if (requestedCategory) {
    acknowledgeRequestedSettingsCategory(requestedCategory)
  }
})

describe("settings navigation", () => {
  it("retains a requested category until the settings page acknowledges it", () => {
    requestOpenSettingsAbout()

    expect(readRequestedSettingsCategory()).toBe("about")
    expect(readRequestedSettingsCategory()).toBe("about")

    acknowledgeRequestedSettingsCategory("about")

    expect(readRequestedSettingsCategory()).toBeNull()
  })

  it("does not let an older acknowledgement clear a newer request", () => {
    requestOpenSettingsAbout()
    requestOpenSettingsDock()

    acknowledgeRequestedSettingsCategory("about")

    expect(readRequestedSettingsCategory()).toBe("dock")
  })
})
