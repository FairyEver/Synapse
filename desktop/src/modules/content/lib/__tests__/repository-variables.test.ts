import { describe, expect, it } from "vitest"

import {
  buildUserVariableChangeSet,
  buildUserVariablesPatch,
  hasUserVariableChanges,
} from "../repository-variables"
import type { SynapseVariable } from "@/types/config"

const variables: SynapseVariable[] = [
  { name: "TOKEN", value: "old", description: "Existing token" },
  { name: "UNCHANGED", value: "same" },
]

describe("user variable change helpers", () => {
  it("detects new and updated variables from submitted substitutions", () => {
    const changeSet = buildUserVariableChangeSet(variables, {
      token: "new",
      API_URL: "https://example.test",
      EMPTY: "",
      UNCHANGED: "same",
    })

    expect(changeSet).toEqual({
      newVariables: [
        { name: "API_URL", value: "https://example.test" },
      ],
      updatedVariables: [
        { name: "TOKEN", value: "new", description: "Existing token" },
      ],
    })
    expect(hasUserVariableChanges(changeSet)).toBe(true)
  })

  it("ignores empty values and unchanged existing values", () => {
    const changeSet = buildUserVariableChangeSet(variables, {
      EMPTY: "",
      unchanged: "same",
    })

    expect(changeSet).toEqual({
      newVariables: [],
      updatedVariables: [],
    })
    expect(hasUserVariableChanges(changeSet)).toBe(false)
  })

  it("builds a patch that appends new variables and updates existing variables", () => {
    const changeSet = buildUserVariableChangeSet(variables, {
      token: "new",
      API_URL: "https://example.test",
    })

    expect(buildUserVariablesPatch(variables, changeSet)).toEqual({
      global: {
        variables: [
          { name: "TOKEN", value: "new", description: "Existing token" },
          { name: "UNCHANGED", value: "same" },
          { name: "API_URL", value: "https://example.test" },
        ],
      },
    })
  })

  it("returns null when there are no changes to persist", () => {
    const changeSet = buildUserVariableChangeSet(variables, {
      TOKEN: "old",
      UNCHANGED: "same",
    })

    expect(buildUserVariablesPatch(variables, changeSet)).toBeNull()
  })
})
