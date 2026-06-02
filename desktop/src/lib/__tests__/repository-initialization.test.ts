import { describe, expect, it } from "vitest"
import {
  getRepositoryInitializationDangerMessage,
  REPOSITORY_INITIALIZATION_DANGER_MESSAGE,
} from "../repository-initialization"

describe("repository initialization helpers", () => {
  it("returns a blocking message when initialization preview has danger flags", () => {
    expect(getRepositoryInitializationDangerMessage({
      dangerFlags: ["desktop"],
      isEmpty: true,
      nonGitEntries: [],
      operationToken: "token-1",
    })).toBe(REPOSITORY_INITIALIZATION_DANGER_MESSAGE)
  })

  it("allows previews without danger flags", () => {
    expect(getRepositoryInitializationDangerMessage({
      dangerFlags: [],
      isEmpty: false,
      nonGitEntries: ["notes.md"],
      operationToken: "token-1",
    })).toBeNull()
  })
})
