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
    {
      id: "cursor",
      label: "Cursor",
      getScanPathConfig: () => ({
        globalSkillsPath: null,
        globalSkillPaths: [],
        globalRulesPath: null,
        rulesSupported: false,
        detectionDir: "/missing-cursor-home",
        projectPaths: (candidateRoot: string) => ({
          skillsPath: candidateRoot === "/repo"
            ? "/repo/.cursor/skills"
            : candidateRoot === "/"
              ? "/.cursor/skills"
              : projectRoot,
          rulesPath: "",
        }),
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
          { id: "cursor", label: "Cursor" },
        ],
        scope: "project",
        projectId: "project-1",
        projectName: "Demo",
        path: await realpath(projectRoot),
      },
    ])
  })

  it("lists global roots without configured project roots", async () => {
    const { listGlobalTrustedSkillRoots } = await import("../editor-scan-roots")

    const roots = await listGlobalTrustedSkillRoots()

    expect(roots.every((root) => root.scope === "global")).toBe(true)
    expect(roots).toHaveLength(1)
  })

  it("attributes a custom candidate through adapter project path rules", async () => {
    const { inferProjectSkillEditors } = await import("../editor-scan-roots")

    const ids = await inferProjectSkillEditors(
      "/repo/.cursor/skills/jenkins",
      "/repo",
    )

    expect(ids).toContain("cursor")
  })

  it("attributes a candidate when the custom search path is the POSIX root", async () => {
    const { inferProjectSkillEditors } = await import("../editor-scan-roots")

    const ids = await inferProjectSkillEditors("/.cursor/skills/jenkins", "/")

    expect(ids).toContain("cursor")
  })

  it("recognizes descendants of Windows drive roots", async () => {
    const { isPathEqualOrInside } = await import("../editor-scan-roots")

    expect(isPathEqualOrInside(
      "C:\\",
      "C:\\Users\\alice\\.cursor\\skills",
      path.win32,
    )).toBe(true)
    expect(isPathEqualOrInside("C:\\", "D:\\skills", path.win32)).toBe(false)
  })
})
