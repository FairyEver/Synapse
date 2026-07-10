import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

let tempRoot = ""
let globalRoot = ""
let globalAlias = ""
let projectRoot = ""

vi.mock("../editor-adapters", () => ({
  editorAdapters: [
    {
      id: "codex",
      label: "Codex",
      getScanPathConfig: () => ({
        globalSkillsPath: globalRoot,
        globalSkillPaths: [globalRoot],
        globalRulesPath: null,
        rulesSupported: false,
        detectionDir: globalRoot,
        projectPaths: () => ({ skillsPath: projectRoot, rulesPath: "" }),
      }),
    },
    {
      id: "claude-code",
      label: "Claude Code",
      getScanPathConfig: () => ({
        globalSkillsPath: globalAlias,
        globalRulesPath: null,
        rulesSupported: false,
        detectionDir: globalAlias,
        projectPaths: () => ({ skillsPath: projectRoot, rulesPath: "" }),
      }),
    },
  ],
}))

vi.mock("../config-store", () => ({
  configStore: {
    load: async () => ({
      global: { projects: [{ id: "project-1", name: "Demo", path: "/project" }] },
    }),
  },
}))

describe("listTrustedSkillRoots", () => {
  beforeAll(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-editor-roots-"))
    globalRoot = path.join(tempRoot, "global")
    globalAlias = path.join(tempRoot, "global-alias")
    projectRoot = path.join(tempRoot, "project")
    await mkdir(globalRoot)
    await mkdir(projectRoot)
    await symlink(globalRoot, globalAlias)
  })

  afterAll(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it("deduplicates physical roots and aggregates every editor identity", async () => {
    const { listTrustedSkillRoots } = await import("../editor-scan-roots")

    await expect(listTrustedSkillRoots()).resolves.toEqual([
      {
        editors: [
          { id: "claude-code", label: "Claude Code" },
          { id: "codex", label: "Codex" },
        ],
        scope: "global",
        path: await realpath(globalRoot),
      },
      {
        editors: [
          { id: "claude-code", label: "Claude Code" },
          { id: "codex", label: "Codex" },
        ],
        scope: "project",
        projectId: "project-1",
        projectName: "Demo",
        path: await realpath(projectRoot),
      },
    ])
  })
})
