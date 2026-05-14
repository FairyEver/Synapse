import { describe, expect, it } from "vitest"

import { resolveAgentProjectScope } from "../project-resolution"

describe("resolveAgentProjectScope", () => {
  it("includes only configured projects and uses a matching active repository path as the default", () => {
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

  it("does not fall back to the repository id when no configured projects exist", () => {
    expect(resolveAgentProjectScope({
      uuid: "repo-1",
      name: "Repository",
      localPath: "/repo",
    }, [])).toEqual({
      defaultProjectId: undefined,
      projectIds: [],
      repositoryId: "repo-1",
      repositoryName: "Repository",
    })
  })

  it("uses the first configured project as default when no active repository path matches", () => {
    expect(resolveAgentProjectScope({
      uuid: "repo-1",
      name: "Active Repository",
      localPath: "/Users/liyang/Active",
    }, [
      { id: "project-1", name: "Other", path: "/Users/liyang/Other" },
    ])).toEqual({
      defaultProjectId: "project-1",
      projectIds: ["project-1"],
      repositoryId: "repo-1",
      repositoryName: "Active Repository",
    })
  })

  it("matches Windows paths case-insensitively", () => {
    expect(resolveAgentProjectScope({
      uuid: "repo-1",
      name: "Desktop",
      localPath: "C:\\Users\\Ada\\Desktop",
    }, [
      { id: "project-1", name: "Desktop Project", path: "c:\\users\\ADA\\Desktop\\" },
    ], "win32").defaultProjectId).toBe("project-1")
  })
})
