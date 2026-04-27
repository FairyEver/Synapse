import { describe, expect, it } from "vitest"

import { resolveAgentProjectScope } from "../project-resolution"

describe("resolveAgentProjectScope", () => {
  it("includes every configured project and defaults to the project matching the active repository path", () => {
    expect(resolveAgentProjectScope({
      uuid: "repo-1",
      name: "Desktop",
      localPath: "/Users/liyang/Desktop/",
    }, [
      { id: "project-2", name: "Other", path: "/Users/liyang/Other" },
      { id: "project-1", name: "Desktop Project", path: "/Users/liyang/Desktop" },
    ])).toEqual({
      defaultProjectId: "project-1",
      projectIds: ["project-2", "project-1"],
      repositoryId: "repo-1",
      repositoryName: "Desktop",
    })
  })

  it("falls back to the repository id only when no configured projects exist", () => {
    expect(resolveAgentProjectScope({
      uuid: "repo-1",
      name: "Repository",
      localPath: "/repo",
    }, [])).toEqual({
      defaultProjectId: "repo-1",
      projectIds: ["repo-1"],
      repositoryId: "repo-1",
      repositoryName: "Repository",
    })
  })
})
