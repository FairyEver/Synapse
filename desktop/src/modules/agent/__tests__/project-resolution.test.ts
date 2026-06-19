import { describe, expect, it } from "vitest"

import {
  DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
  DEFAULT_AGENT_WORKSPACE_PROJECT_NAME,
} from "@/lib/default-agent-workspace"
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
      projectIds: [DEFAULT_AGENT_WORKSPACE_PROJECT_ID, "project-2", "project-1"],
      repositoryId: "repo-1",
      repositoryName: "Desktop",
    })
  })

  it("uses the built-in workspace when no configured projects exist", () => {
    expect(resolveAgentProjectScope({
      uuid: "repo-1",
      name: "Repository",
      localPath: "/repo",
    }, [])).toEqual({
      defaultProjectId: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
      projectIds: [DEFAULT_AGENT_WORKSPACE_PROJECT_ID],
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
      defaultProjectId: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
      projectIds: [DEFAULT_AGENT_WORKSPACE_PROJECT_ID, "project-1"],
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

  it("matches active repository paths to projects after resolving dot segments", () => {
    expect(resolveAgentProjectScope({
      uuid: "repo-1",
      name: "Desktop",
      localPath: "/Users/liyang/tmp/../Desktop",
    }, [
      { id: "project-1", name: "Desktop Project", path: "/Users/liyang/Desktop" },
    ]).defaultProjectId).toBe("project-1")
  })

  it("always includes the built-in local Agent workspace", () => {
    expect(resolveAgentProjectScope(null, [])).toEqual({
      defaultProjectId: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
      projectIds: [DEFAULT_AGENT_WORKSPACE_PROJECT_ID],
      repositoryId: undefined,
      repositoryName: undefined,
    })
  })

  it("prepends the built-in local Agent workspace before configured projects", () => {
    expect(resolveAgentProjectScope(null, [
      { id: "project-1", name: "Project One", path: "/repo" },
    ])).toEqual({
      defaultProjectId: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
      projectIds: [DEFAULT_AGENT_WORKSPACE_PROJECT_ID, "project-1"],
      repositoryId: undefined,
      repositoryName: undefined,
    })
  })

  it("keeps the built-in workspace display name stable", () => {
    expect(DEFAULT_AGENT_WORKSPACE_PROJECT_NAME).toBe("本地对话")
  })
})
