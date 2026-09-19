import { mkdtempSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { createTerminalService } from "../service"
import type { TerminalStore, TerminalStoreState } from "../store"
import type { PtyLike } from "../service"

const PROJECT_ALPHA = { projectId: "project-alpha", name: "Alpha" }
const PROJECT_BETA = { projectId: "project-beta", name: "Beta" }

describe("terminal project groups", () => {
  it("gives every project a group named after it, and keeps one group per project", async () => {
    const harness = await startedHarness()

    await harness.service.syncProjectGroups([harness.alpha, harness.beta])

    expect(projectGroups(harness.service)).toEqual([
      ["项目:Alpha", "project-alpha"],
      ["项目:Beta", "project-beta"],
    ])
    expect(projectGroupFor(harness.service, "project-alpha")?.settings?.defaultCwd).toBe(harness.alpha.path)

    // Second pass: the same projects, the same groups — and no second copy of either.
    const before = harness.service.listGroups().map((group) => group.id)
    await harness.service.syncProjectGroups([harness.alpha, harness.beta])
    expect(harness.service.listGroups().map((group) => group.id)).toEqual(before)
  })

  it("follows a renamed project without making a new group", async () => {
    const harness = await startedHarness()
    await harness.service.syncProjectGroups([harness.alpha])
    const original = projectGroupFor(harness.service, "project-alpha")

    await harness.service.syncProjectGroups([{ projectId: "project-alpha", name: "Alpha 2" }])

    const renamed = projectGroupFor(harness.service, "project-alpha")
    expect(renamed?.id).toBe(original?.id)
    expect(renamed?.name).toBe("项目:Alpha 2")
  })

  it("takes the group and its terminals away with the project", async () => {
    const harness = await startedHarness()
    await harness.service.syncProjectGroups([harness.alpha, harness.beta])
    const kept = await harness.service.createSession({ projectId: PROJECT_BETA.projectId })
    const doomed = await harness.service.createSession({ projectId: PROJECT_ALPHA.projectId })
    const deleted: string[] = []
    harness.service.events.on("sessionDeleted", (payload: { sessionId: string }) => {
      deleted.push(payload.sessionId)
    })

    await harness.service.syncProjectGroups([harness.beta])

    expect(projectGroups(harness.service)).toEqual([["项目:Beta", "project-beta"]])
    expect(harness.service.listSessions().map((session) => session.id)).toEqual([kept.id])
    expect(harness.service.listWorkspaces().every((workspace) => workspace.groupId === kept.groupId)).toBe(true)
    expect(deleted).toEqual([doomed.id])
    expect(harness.store.state.groups.flatMap((group) => group.projectId ?? [])).toEqual(["project-beta"])
  })

  it("puts a terminal created for a project in that project's group", async () => {
    const harness = await startedHarness()
    await harness.service.syncProjectGroups([harness.alpha, harness.beta])
    const beta = projectGroupFor(harness.service, "project-beta")

    const session = await harness.service.createSession({ projectId: PROJECT_BETA.projectId })

    expect(session.groupId).toBe(beta?.id)
  })

  it("makes the group for a launch that names a project before any sync", async () => {
    const harness = await startedHarness()

    const session = await harness.service.createSessionWithEphemeralEnvironment({
      project: harness.alpha,
      cwd: harness.cwd,
      shell: "/bin/zsh",
      environment: {},
    })

    const group = projectGroupFor(harness.service, "project-alpha")
    expect(group).toMatchObject({ name: "项目:Alpha", projectId: "project-alpha" })
    expect(session.groupId).toBe(group?.id)
  })

  /**
   * The bug this whole arrangement exists to prevent, in its smallest form: a terminal
   * nobody addressed belongs to the user, not to whichever project happens to sit at
   * the top of the list.
   */
  it("keeps an unaddressed terminal out of the project groups", async () => {
    const harness = await startedHarness()
    await harness.service.syncProjectGroups([harness.alpha])
    // Dragged to the top, which is where a project group is most tempting as "the
    // first group is the default one".
    const alpha = projectGroupFor(harness.service, "project-alpha")
    await harness.service.reorderGroups({
      groupIds: [alpha!.id, ...harness.service.listGroups().map((group) => group.id).filter((id) => id !== alpha!.id)],
    })

    const session = await harness.service.createSession({})

    const group = harness.service.listGroups().find((item) => item.id === session.groupId)
    expect(group).toMatchObject({ name: "默认" })
    expect(group?.projectId).toBeUndefined()
  })

  /**
   * The working directory is what makes a project group worth having: open a terminal
   * in it and it is already standing in the project. Only an empty slot is filled —
   * once the user has chosen one, the project stops dictating it.
   */
  it("starts a project group in the project's own folder, until the user says otherwise", async () => {
    const harness = await startedHarness()

    await harness.service.syncProjectGroups([harness.alpha])
    expect(projectGroupFor(harness.service, "project-alpha")?.settings?.defaultCwd).toBe(harness.alpha.path)

    const group = projectGroupFor(harness.service, "project-alpha")!
    await harness.service.updateGroupSettings({
      groupId: group.id,
      name: group.name,
      settings: { defaultCwd: os.tmpdir() },
    })
    await harness.service.syncProjectGroups([{ ...harness.alpha, path: harness.beta.path }])

    expect(projectGroupFor(harness.service, "project-alpha")?.settings?.defaultCwd).toBe(os.tmpdir())
  })

  it("leaves a project group without a working directory when the caller has no folder for it", async () => {
    const harness = await startedHarness()

    await harness.service.syncProjectGroups([PROJECT_ALPHA])

    expect(projectGroupFor(harness.service, "project-alpha")?.settings?.defaultCwd).toBeUndefined()
  })

  it("refuses to rename or delete a project group, whoever asks", async () => {
    const harness = await startedHarness()
    await harness.service.syncProjectGroups([harness.alpha])
    const group = projectGroupFor(harness.service, "project-alpha")!

    await expect(harness.service.renameGroup({ groupId: group.id, name: "我的" })).rejects.toMatchObject({
      payload: { code: "invalid_argument", details: { reason: "project_group_is_managed" } },
    })
    await expect(harness.service.deleteGroup({ groupId: group.id })).rejects.toMatchObject({
      payload: { code: "invalid_argument", details: { reason: "project_group_is_managed" } },
    })
    expect(harness.service.getGroup(group.id).name).toBe("项目:Alpha")
  })

  it("still lets a project group carry its own launch settings", async () => {
    const harness = await startedHarness()
    await harness.service.syncProjectGroups([harness.alpha])
    const group = projectGroupFor(harness.service, "project-alpha")!

    const updated = await harness.service.updateGroupSettings({
      groupId: group.id,
      name: group.name,
      settings: { defaultCwd: os.tmpdir() },
    })

    expect(updated.settings?.defaultCwd).toBe(os.tmpdir())
  })

  it("leaves the groups the user made alone", async () => {
    const harness = await startedHarness()
    const mine = await harness.service.createGroup({ name: "部署" })

    await harness.service.syncProjectGroups([harness.alpha, harness.beta])
    await harness.service.syncProjectGroups([])

    expect(projectGroups(harness.service)).toEqual([])
    expect(harness.service.getGroup(mine.id).name).toBe("部署")
    expect(harness.service.getGroup(mine.id).projectId).toBeUndefined()
  })
})

function projectGroupFor(service: ReturnType<typeof createTerminalService>, projectId: string) {
  return service.listGroups().find((group) => group.projectId === projectId)
}

function projectGroups(service: ReturnType<typeof createTerminalService>): Array<[string, string]> {
  return service.listGroups()
    .filter((group) => group.projectId !== undefined)
    .map((group) => [group.name, group.projectId!] as [string, string])
}

function projectSource(projectId: string, name: string, path: string) {
  return { projectId, name, path }
}

async function startedHarness() {
  const pty = fakePty()
  const cwd = mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-project-groups-"))
  const store = memoryStore()
  const service = createTerminalService({
    store,
    spawnPty: () => pty,
    resolveDefaultShell: () => "/bin/zsh",
    resolveDefaultCwd: () => cwd,
    resolveEffectivePath: () => "/usr/bin:/bin",
  })
  await service.start()
  // Real directories: a group that carries a working directory has it used by the
  // terminals created in it, and a path that does not exist is a failed launch.
  const alpha = mkdtempSync(path.join(os.tmpdir(), "synapse-project-alpha-"))
  const beta = mkdtempSync(path.join(os.tmpdir(), "synapse-project-beta-"))
  return {
    service,
    pty,
    store,
    cwd,
    alpha: projectSource(PROJECT_ALPHA.projectId, PROJECT_ALPHA.name, alpha),
    beta: projectSource(PROJECT_BETA.projectId, PROJECT_BETA.name, beta),
  }
}

function memoryStore(): TerminalStore & { state: TerminalStoreState } {
  const holder = {
    persistenceProtection: "available" as const,
    state: {
      groups: [],
      sessions: [],
      output: [],
      terminalDomainRevision: 0,
      operations: [],
      idempotency: [],
      checkpoints: [],
    } as TerminalStoreState,
    async loadState() { return structuredClone(holder.state) },
    async saveState(state: TerminalStoreState) { holder.state = structuredClone(state) },
  }
  return holder
}

function fakePty(): PtyLike {
  return {
    pid: 4242,
    onData: () => ({ dispose: () => undefined }),
    onExit: () => ({ dispose: () => undefined }),
    write: () => undefined,
    resize: () => undefined,
    kill: () => undefined,
  }
}
