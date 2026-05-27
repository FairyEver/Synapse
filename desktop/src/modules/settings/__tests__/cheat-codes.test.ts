import { describe, expect, it, vi } from "vitest"

import {
  CHEAT_CODE_INTERACTION_RESET_DELAY,
  CHEAT_CODE_LOGO_CLICK_THRESHOLD,
  SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES,
  SETTINGS_CHEAT_CODE_TITLE,
  buildSettingsTitleParts,
  getSettingsTitleActiveColorClass,
  settingsCheatCodes,
  settingsTitleParts,
  validateCheatCodeRegistrations,
  type CheatCodeRegistration,
} from "@/modules/settings/cheat-codes"

describe("settings cheat codes", () => {
  it("defines shared interaction constants in one place", () => {
    expect(CHEAT_CODE_INTERACTION_RESET_DELAY).toBe(10000)
    expect(CHEAT_CODE_LOGO_CLICK_THRESHOLD).toBe(10)
  })

  it("builds stable title parts with duplicate characters separated by index", () => {
    expect(SETTINGS_CHEAT_CODE_TITLE).toBe("Synapse AI Studio")

    expect(settingsTitleParts[0]).toEqual({ index: 0, char: "S", clickable: true })
    expect(settingsTitleParts[7]).toEqual({ index: 7, char: " ", clickable: false })
    expect(settingsTitleParts[11]).toEqual({ index: 11, char: "S", clickable: true })
    expect(settingsTitleParts[16]).toEqual({ index: 16, char: "o", clickable: true })
  })

  it("can build title parts for validation tests", () => {
    expect(buildSettingsTitleParts("A B")).toEqual([
      { index: 0, char: "A", clickable: true },
      { index: 1, char: " ", clickable: false },
      { index: 2, char: "B", clickable: true },
    ])
  })

  it("uses the Claude Code ROYGBIV order with Tailwind default text color classes", () => {
    expect(SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES).toEqual([
      "text-red-500",
      "text-orange-500",
      "text-yellow-500",
      "text-green-500",
      "text-blue-500",
      "text-indigo-500",
      "text-violet-500",
    ])
    expect(SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES.every((className) => {
      return className.startsWith("text-") && !className.includes("[") && !className.includes("#")
    })).toBe(true)
    expect(getSettingsTitleActiveColorClass(0, 0)).toBe(SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES[0])
    expect(getSettingsTitleActiveColorClass(1, 1)).toBe(SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES[0])
    expect(getSettingsTitleActiveColorClass(2, 2)).toBe(SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES[0])
  })

  it("registers repository maintenance through the centralized registry", () => {
    const enableRepositoryMaintenance = vi.fn()

    expect(settingsCheatCodes).toHaveLength(1)
    expect(settingsCheatCodes[0]?.definition.name).toBe("settings:repository-maintenance:enable")
    expect(settingsCheatCodes[0]?.definition.kind).toBe("action")
    expect(settingsCheatCodes[0]?.binding.settingsTitleSequence).toEqual([0, 11, 8, 9])

    const definition = settingsCheatCodes[0]?.definition
    if (definition?.kind === "action") {
      definition.run({ enableRepositoryMaintenance })
    }

    expect(enableRepositoryMaintenance).toHaveBeenCalledTimes(1)
  })

  it("rejects duplicate cheat code names", () => {
    expect(() =>
      validateCheatCodeRegistrations([
        createRegistration({ name: "settings:test", settingsTitleSequence: [0] }),
        createRegistration({ name: "settings:test", settingsTitleSequence: [2] }),
      ], buildSettingsTitleParts("ABC")),
    ).toThrow("Duplicate cheat code name: settings:test")
  })

  it("rejects duplicate title sequences", () => {
    expect(() =>
      validateCheatCodeRegistrations([
        createRegistration({ name: "settings:first", settingsTitleSequence: [0, 2] }),
        createRegistration({ name: "settings:second", settingsTitleSequence: [0, 2] }),
      ], buildSettingsTitleParts("ABC")),
    ).toThrow("Duplicate title sequence: 0,2")
  })

  it("rejects invalid names and empty sequences", () => {
    expect(() =>
      validateCheatCodeRegistrations([
        createRegistration({ name: " ", settingsTitleSequence: [0] }),
      ], buildSettingsTitleParts("ABC")),
    ).toThrow("Cheat code name is required.")

    expect(() =>
      validateCheatCodeRegistrations([
        createRegistration({ name: "settings:empty", settingsTitleSequence: [] }),
      ], buildSettingsTitleParts("ABC")),
    ).toThrow("Cheat code settingsTitleSequence is required for settings:empty.")
  })

  it("rejects invalid and non-clickable title indexes", () => {
    expect(() =>
      validateCheatCodeRegistrations([
        createRegistration({ name: "settings:outside", settingsTitleSequence: [99] }),
      ], buildSettingsTitleParts("ABC")),
    ).toThrow("Title sequence index 99 is outside the title.")

    expect(() =>
      validateCheatCodeRegistrations([
        createRegistration({ name: "settings:space", settingsTitleSequence: [1] }),
      ], buildSettingsTitleParts("A B")),
    ).toThrow("Title sequence index 1 is not clickable.")
  })

  it("rejects prefix conflicts between title sequences", () => {
    expect(() =>
      validateCheatCodeRegistrations([
        createRegistration({ name: "settings:short", settingsTitleSequence: [0, 1] }),
        createRegistration({ name: "settings:long", settingsTitleSequence: [0, 1, 2] }),
      ], buildSettingsTitleParts("ABC")),
    ).toThrow("Title sequence prefix conflict: settings:short and settings:long")
  })
})

function createRegistration(
  overrides: {
    readonly name?: string
    readonly settingsTitleSequence?: readonly number[]
  } = {},
): CheatCodeRegistration {
  return {
    definition: {
      name: overrides.name ?? "settings:test",
      kind: "action",
      run: () => {},
    },
    binding: {
      settingsTitleSequence: overrides.settingsTitleSequence ?? [0],
    },
  }
}
