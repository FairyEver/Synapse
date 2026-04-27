import { describe, expect, it } from "vitest"

import { resolveSettingsAgentProjectId } from "../project-scope"

describe("resolveSettingsAgentProjectId", () => {
  it("uses the matching configured project for the active repository path", () => {
    expect(resolveSettingsAgentProjectId({
      uuid: "repo-1",
      localPath: "/Users/liyang/Desktop/",
    }, [
      { id: "project-2", name: "Other", path: "/Users/liyang/Other" },
      { id: "project-1", name: "Desktop", path: "/Users/liyang/Desktop" },
    ])).toBe("project-1")
  })

  it("uses the active repository id before unrelated configured projects", () => {
    expect(resolveSettingsAgentProjectId({
      uuid: "repo-1",
      localPath: "/repo",
    }, [
      { id: "project-2", name: "Other", path: "/other" },
    ])).toBe("repo-1")
  })

  it("falls back to the first configured project without an active repository", () => {
    expect(resolveSettingsAgentProjectId(null, [
      { id: "project-1", name: "Project", path: "/project" },
    ])).toBe("project-1")
  })
})
