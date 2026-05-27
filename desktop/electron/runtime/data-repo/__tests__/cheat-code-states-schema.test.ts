import { describe, expect, it } from "vitest"

import { cheatCodeStatesSchema } from "../schemas/cheat-code-states"

describe("cheat code states schema", () => {
  it("defaults to an empty v1 state map", () => {
    expect(cheatCodeStatesSchema.defaults?.()).toEqual({
      schemaVersion: 1,
      states: {},
    })
  })

  it("accepts boolean states and rejects non-boolean state values", () => {
    expect(cheatCodeStatesSchema.validate({
      schemaVersion: 1,
      states: {
        "settings:test": true,
        "settings:other": false,
      },
    })).toBe(true)

    expect(cheatCodeStatesSchema.validate({
      schemaVersion: 1,
      states: {
        "settings:test": "true",
      },
    })).toBe(false)
  })
})
