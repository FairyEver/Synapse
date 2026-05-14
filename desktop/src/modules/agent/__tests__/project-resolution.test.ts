import { describe, expect, it } from "vitest"

import { resolveAgentProjectScope } from "../project-resolution"

describe("resolveAgentProjectScope", () => {
  it("includes every configured project plus the active repository id for legacy local sessions", () => {
    expect(resolveAgentProjectScope({
      uuid: "repo-1",
      name: "Desktop",
      localPath: "/Users/liyang/Desktop/",
    }, [
      { id: "project-2", name: "Other", path: "/Users/liyang/Other" },
      { id: "project-1", name: "Desktop Project", path: "/Users/liyang/Desktop" },
    ])).toEqual({
      defaultProjectId: "project-1",
      projectIds: ["project-2", "project-1", "repo-1"],
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

  it("uses the active repository id as default when no configured project path matches", () => {
    expect(resolveAgentProjectScope({
      uuid: "repo-1",
      name: "Active Repository",
      localPath: "/Users/liyang/Active",
    }, [
      { id: "project-1", name: "Other", path: "/Users/liyang/Other" },
    ])).toEqual({
      defaultProjectId: "repo-1",
      projectIds: ["project-1", "repo-1"],
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
