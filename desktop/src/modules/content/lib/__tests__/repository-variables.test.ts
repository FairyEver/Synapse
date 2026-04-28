import { describe, expect, it } from "vitest"

import { buildRepositoryVariablesPatch } from "../repository-variables"
import type { SynapseRepositoryConfig } from "@/types/config"

const repository: SynapseRepositoryConfig = {
  uuid: "repo-1",
  name: "Main",
  localPath: "/repo",
  contentDirs: {},
  variables: [
    { name: "TOKEN", value: "old" },
  ],
}

describe("buildRepositoryVariablesPatch", () => {
  it("adds only missing variables to the active repository patch", () => {
    expect(buildRepositoryVariablesPatch(repository, {
      token: "new",
      API_URL: "https://example.test",
      EMPTY: "",
    })).toEqual({
      variables: [
        { name: "TOKEN", value: "old" },
        { name: "API_URL", value: "https://example.test" },
      ],
    })
  })

  it("returns null when every submitted variable already exists or is empty", () => {
    expect(buildRepositoryVariablesPatch(repository, {
      token: "new",
      EMPTY: "",
    })).toBeNull()
  })
})
