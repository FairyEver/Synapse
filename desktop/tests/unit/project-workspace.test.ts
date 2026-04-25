import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  bindWorkspace,
  clearProjectWorkDirOverride,
  clearWorkspaceDirOverride,
  createProjectWorkspaceDraft,
  inspectProjectPath,
  lookupEffectiveWorkspaceBinding,
  setProjectWorkDirOverride,
  setWorkspaceDirOverride,
  unbindWorkspace,
  workspaceChannelKey,
} from "../../electron/services/project-workspace-service"
import { sanitizeSynapseConfig } from "../../src/lib/config"

describe("project workspace model", () => {
  it("maps CC Connect projects to 3S project config with a default project", () => {
    const draft = createProjectWorkspaceDraft([
      {
        name: "alpha",
        mode: null,
        workDir: "/workspace/alpha",
        baseDir: null,
        agentType: "codex",
        providerRefs: [],
        activeProvider: null,
        platformTypes: ["telegram"],
        runAsUser: null,
        runAsEnv: [],
        issues: [],
      },
      {
        name: "shared",
        mode: "multi-workspace",
        workDir: null,
        baseDir: "/workspace",
        agentType: "codex",
        providerRefs: [],
        activeProvider: null,
        platformTypes: ["slack"],
        runAsUser: null,
        runAsEnv: [],
        issues: [],
      },
    ], { defaultProjectName: "shared" })

    expect(draft.issues).toEqual([])
    expect(draft.projects).toHaveLength(2)
    expect(draft.projects[0]).toMatchObject({
      name: "alpha",
      path: "/workspace/alpha",
      mode: "single",
      workDir: "/workspace/alpha",
      source: "cc-connect",
    })
    expect(draft.projects[1]).toMatchObject({
      name: "shared",
      path: "/workspace",
      mode: "multi-workspace",
      baseDir: "/workspace",
    })
    expect(draft.defaultProjectId).toBe(draft.projects[1]?.id)
  })

  it("keeps project and workspace work_dir overrides separately", () => {
    const project = {
      id: "alpha",
      name: "alpha",
      path: "/workspace/alpha",
      mode: "single" as const,
      workDir: "/workspace/alpha",
    }

    const movedProject = setProjectWorkDirOverride(project, "/workspace/beta")
    const restoredProject = clearProjectWorkDirOverride(movedProject)
    const withWorkspaceOverride = setWorkspaceDirOverride(
      movedProject,
      "/workspace/channel-a",
      "/workspace/channel-a/override",
    )
    const cleared = clearWorkspaceDirOverride(withWorkspaceOverride, "/workspace/channel-a")

    expect(movedProject.path).toBe("/workspace/beta")
    expect(movedProject.workDir).toBe("/workspace/alpha")
    expect(movedProject.workDirOverride).toBe("/workspace/beta")
    expect(restoredProject.path).toBe("/workspace/alpha")
    expect(restoredProject.workDirOverride).toBeUndefined()
    expect(withWorkspaceOverride.workspaceDirOverrides).toEqual({
      [path.normalize("/workspace/channel-a")]: path.normalize("/workspace/channel-a/override"),
    })
    expect(cleared.workspaceDirOverrides).toBeUndefined()
  })

  it("uses project bindings before shared bindings and supports legacy channel keys", () => {
    const channelKey = workspaceChannelKey("slack", "C1")
    const sharedOnly = bindWorkspace([], {
      projectId: null,
      platform: "slack",
      channelId: "C1",
      channelName: "shared-channel",
      workspacePath: "/workspace/shared",
      boundAt: "2026-04-25T00:00:00.000Z",
    })
    const withProjectOverride = bindWorkspace(sharedOnly, {
      projectId: "project-b",
      platform: "slack",
      channelId: "C1",
      channelName: "project-channel",
      workspacePath: "/workspace/project-b",
      boundAt: "2026-04-25T00:01:00.000Z",
    })

    expect(lookupEffectiveWorkspaceBinding(sharedOnly, "project-a", channelKey)).toMatchObject({
      source: "shared",
      binding: { workspacePath: "/workspace/shared" },
    })
    expect(lookupEffectiveWorkspaceBinding(withProjectOverride, "project-b", channelKey)).toMatchObject({
      source: "project",
      binding: { workspacePath: "/workspace/project-b" },
    })
    expect(lookupEffectiveWorkspaceBinding(sharedOnly, "project-a", "slack:C1")).toMatchObject({
      source: "shared",
      binding: { workspacePath: "/workspace/shared" },
    })
    expect(unbindWorkspace(withProjectOverride, "project-b", channelKey)).toHaveLength(1)
  })

  it("sanitizes project defaults and workspace bindings inside config", () => {
    const draft = createProjectWorkspaceDraft([
      {
        name: "alpha",
        mode: null,
        workDir: "/workspace/alpha",
        baseDir: null,
        agentType: "codex",
        providerRefs: [],
        activeProvider: null,
        platformTypes: ["telegram"],
        runAsUser: null,
        runAsEnv: [],
        issues: [],
      },
    ])
    const bindings = bindWorkspace([], {
      projectId: draft.projects[0]?.id ?? null,
      platform: "telegram",
      channelId: "chat-1",
      channelName: "chat",
      workspacePath: "/workspace/alpha",
      boundAt: "2026-04-25T00:00:00.000Z",
    })
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        projects: draft.projects,
        defaultProjectId: draft.defaultProjectId,
        workspaceBindings: bindings,
      },
    })

    expect(config.global.defaultProjectId).toBe(draft.defaultProjectId)
    expect(config.global.workspaceBindings).toHaveLength(1)
    expect(config.global.projects[0]).toMatchObject({
      source: "cc-connect",
      workDir: "/workspace/alpha",
    })
  })

  it("reports invalid path state through an explicit inspector", async () => {
    const inspection = await inspectProjectPath({
      id: "missing",
      name: "missing",
      path: "/workspace/missing",
    }, async () => "missing" as const)

    expect(inspection).toEqual({
      path: "/workspace/missing",
      status: "missing",
    })
  })
})
