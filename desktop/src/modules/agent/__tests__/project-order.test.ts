import { describe, expect, it } from "vitest"
import { DEFAULT_AGENT_WORKSPACE_PROJECT_ID } from "@/lib/default-agent-workspace"
import {
  moveAgentProjectId,
  normalizeAgentProjectOrder,
  orderAgentProjects,
  splitPinnedAgentProjects,
} from "../project-order"

const projects = [
  { id: "project-a", name: "Project A" },
  { id: "project-b", name: "Project B" },
  { id: "project-c", name: "Project C" },
]

describe("agent project order", () => {
  it("keeps only known project ids from the stored order", () => {
    expect(normalizeAgentProjectOrder(projects, undefined)).toEqual([])
    expect(normalizeAgentProjectOrder(projects, [
      "project-c",
      "project-c",
      "  ",
      "",
      "project-missing",
      42,
      " project-b ",
    ])).toEqual(["project-c", "project-b"])
  })

  it("orders recorded projects first and appends the remaining ones", () => {
    expect(orderAgentProjects(projects, ["project-b"]).map((project) => project.id))
      .toEqual(["project-b", "project-a", "project-c"])
    expect(orderAgentProjects(projects, []).map((project) => project.id))
      .toEqual(["project-a", "project-b", "project-c"])
    expect(orderAgentProjects(projects, ["project-missing", "project-c"]).map((project) => project.id))
      .toEqual(["project-c", "project-a", "project-b"])
  })

  it("moves a project one step and keeps the list when nothing changes", () => {
    const projectIds = ["project-a", "project-b", "project-c"]

    expect(moveAgentProjectId(projectIds, "project-b", "up"))
      .toEqual(["project-b", "project-a", "project-c"])
    expect(moveAgentProjectId(projectIds, "project-b", "down"))
      .toEqual(["project-a", "project-c", "project-b"])
    expect(moveAgentProjectId(projectIds, "project-a", "up")).toBe(projectIds)
    expect(moveAgentProjectId(projectIds, "project-c", "down")).toBe(projectIds)
    expect(moveAgentProjectId(projectIds, "project-missing", "up")).toBe(projectIds)
  })

  it("keeps the local conversation workspace out of the sortable list", () => {
    const { pinned, sortable } = splitPinnedAgentProjects([
      { id: DEFAULT_AGENT_WORKSPACE_PROJECT_ID, name: "本地对话" },
      ...projects,
    ])

    expect(pinned.map((project) => project.id)).toEqual([DEFAULT_AGENT_WORKSPACE_PROJECT_ID])
    expect(sortable.map((project) => project.id)).toEqual(["project-a", "project-b", "project-c"])
  })
})
