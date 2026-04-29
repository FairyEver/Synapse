import { describe, expect, it } from "vitest"

import {
  buildRepositoryVariableChangeSet,
  buildRepositoryVariablesPatch,
  hasRepositoryVariableChanges,
} from "../repository-variables"
import type { SynapseRepositoryConfig } from "@/types/config"

const repository: SynapseRepositoryConfig = {
  uuid: "repo-1",
  name: "Main",
  localPath: "/repo",
  contentDirs: {},
  variables: [
    { name: "TOKEN", value: "old", description: "Existing token" },
    { name: "UNCHANGED", value: "same" },
  ],
}

describe("repository variable change helpers", () => {
  it("detects new and updated variables from submitted substitutions", () => {
    const changeSet = buildRepositoryVariableChangeSet(repository, {
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
    expect(hasRepositoryVariableChanges(changeSet)).toBe(true)
  })

  it("ignores empty values and unchanged existing values", () => {
    const changeSet = buildRepositoryVariableChangeSet(repository, {
      EMPTY: "",
      unchanged: "same",
    })

    expect(changeSet).toEqual({
      newVariables: [],
      updatedVariables: [],
    })
    expect(hasRepositoryVariableChanges(changeSet)).toBe(false)
  })

  it("builds a patch that appends new variables and updates existing variables", () => {
    const changeSet = buildRepositoryVariableChangeSet(repository, {
      token: "new",
      API_URL: "https://example.test",
    })

    expect(buildRepositoryVariablesPatch(repository, changeSet)).toEqual({
      variables: [
        { name: "TOKEN", value: "new", description: "Existing token" },
        { name: "UNCHANGED", value: "same" },
        { name: "API_URL", value: "https://example.test" },
      ],
    })
  })

  it("returns null when there are no changes to persist", () => {
    const changeSet = buildRepositoryVariableChangeSet(repository, {
      TOKEN: "old",
      UNCHANGED: "same",
    })

    expect(buildRepositoryVariablesPatch(repository, changeSet)).toBeNull()
  })
})
