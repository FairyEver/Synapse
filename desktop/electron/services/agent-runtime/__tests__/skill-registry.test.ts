import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  SkillRegistry,
  buildSkillInvocationPrompt,
} from "../skill-registry"

describe("SkillRegistry", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("discovers SKILL.md files and builds invocation prompts", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-skill-"))
    const skillDir = path.join(workspace, ".agents", "skills", "reviewer")
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(path.join(skillDir, "SKILL.md"), [
      "---",
      "name: Reviewer",
      "description: Review code",
      "---",
      "Inspect the diff.",
    ].join("\n"))

    const registry = new SkillRegistry({ workspacePath: workspace })
    const skill = await registry.resolve("reviewer")

    expect(skill).toEqual(expect.objectContaining({
      name: "reviewer",
      displayName: "Reviewer",
      description: "Review code",
    }))
    expect(buildSkillInvocationPrompt(skill!, ["src/app.ts"]))
      .toContain("## User Arguments:\nsrc/app.ts")
  })

  it("classifies only valid Synapse-installed skills as user installed", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-skill-"))
    const skillsRoot = path.join(workspace, ".agents", "skills")
    const fixtures = [
      { name: "mine", identity: { id: "skill-1" }, expected: "synapse-installed" },
      { name: "external", expected: "other" },
      { name: "broken", identity: "not-json", expected: "other" },
      {
        name: "cloud",
        identity: { id: "repo-skill", kind: "cloud-skill-repository" },
        expected: "other",
      },
    ] as const

    for (const fixture of fixtures) {
      const skillDir = path.join(skillsRoot, fixture.name)
      await fs.mkdir(skillDir, { recursive: true })
      await fs.writeFile(path.join(skillDir, "SKILL.md"), `# ${fixture.name}`)
      if ("identity" in fixture) {
        await fs.writeFile(
          path.join(skillDir, ".synapse.json"),
          typeof fixture.identity === "string" ? fixture.identity : JSON.stringify(fixture.identity),
        )
      }
    }

    const published = await new SkillRegistry({ workspacePath: workspace }).listPublished()

    expect(Object.fromEntries(published.map((skill) => [skill.name, skill.skillOrigin]))).toMatchObject(
      Object.fromEntries(fixtures.map((fixture) => [fixture.name, fixture.expected])),
    )
  })

  it("reuses cached skill metadata for repeated resolves", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-skill-"))
    const skillDir = path.join(workspace, ".agents", "skills", "reviewer")
    const skillPath = path.join(skillDir, "SKILL.md")
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(skillPath, [
      "---",
      "name: Reviewer",
      "description: Review code",
      "---",
      "Inspect the diff.",
    ].join("\n"))

    const originalReadFile = fs.readFile.bind(fs)
    const readFile = vi.spyOn(fs, "readFile").mockImplementation((filePath, options) =>
      originalReadFile(filePath, options))
    const registry = new SkillRegistry({ workspacePath: workspace })

    await expect(registry.resolve("reviewer")).resolves.toEqual(expect.objectContaining({ name: "reviewer" }))
    await expect(registry.resolve("reviewer")).resolves.toEqual(expect.objectContaining({ name: "reviewer" }))

    expect(readFile.mock.calls.filter(([filePath]) =>
      path.basename(String(filePath)) === "SKILL.md"
      && path.basename(path.dirname(String(filePath))) === "reviewer").length).toBe(1)
  })

  it("skips unreadable skill files with diagnostics", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-skill-"))
    const goodDir = path.join(workspace, ".agents", "skills", "reviewer")
    const brokenDir = path.join(workspace, ".agents", "skills", "broken")
    const goodSkillPath = path.join(goodDir, "SKILL.md")
    const brokenSkillPath = path.join(brokenDir, "SKILL.md")
    await fs.mkdir(goodDir, { recursive: true })
    await fs.mkdir(brokenDir, { recursive: true })
    await fs.writeFile(goodSkillPath, [
      "---",
      "name: Reviewer",
      "description: Review code",
      "---",
      "Inspect the diff.",
    ].join("\n"))
    await fs.writeFile(brokenSkillPath, "This file cannot be read.")

    const originalReadFile = fs.readFile.bind(fs)
    vi.spyOn(fs, "readFile").mockImplementation(async (filePath, options) => {
      if (path.basename(path.dirname(String(filePath))) === "broken") {
        const error = new Error(`EACCES: permission denied, open '${brokenSkillPath}'`)
        Object.assign(error, { code: "EACCES" })
        throw error
      }
      return originalReadFile(filePath, options)
    })
    const logger = { warn: vi.fn() }
    const registry = new SkillRegistry({ projectId: "project-1", workspacePath: workspace, logger })

    const skills = await registry.list()

    expect(skills.map((skill) => skill.name)).toContain("reviewer")
    expect(skills.map((skill) => skill.name)).not.toContain("broken")
    expect(logger.warn).toHaveBeenCalledWith("Agent skill file skipped.", expect.objectContaining({
      boundary: "agent.skill.file-read",
      fileName: "SKILL.md",
      projectId: "project-1",
      skillName: "broken",
      errorCode: "EACCES",
      errorName: "Error",
      errorLength: `EACCES: permission denied, open '${brokenSkillPath}'`.length,
      error: expect.stringContaining("[path redacted]"),
    }))
  })

  it("redacts unquoted absolute paths in skill file diagnostics", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-skill-"))
    const brokenDir = path.join(workspace, ".agents", "skills", "broken")
    const brokenSkillPath = path.join(brokenDir, "SKILL.md")
    await fs.mkdir(brokenDir, { recursive: true })
    await fs.writeFile(brokenSkillPath, "This file cannot be read.")

    vi.spyOn(fs, "readFile").mockRejectedValue(
      new Error("EACCES: permission denied, open /Users/example/.codex/skills/broken/SKILL.md"),
    )
    const logger = { warn: vi.fn() }
    const registry = new SkillRegistry({ projectId: "project-1", workspacePath: workspace, logger })

    await registry.list()

    expect(logger.warn).toHaveBeenCalledWith("Agent skill file skipped.", expect.objectContaining({
      skillName: "broken",
      error: "EACCES: permission denied, open [path redacted]",
    }))
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("/Users/example")
  })

  it("keeps slash command names while redacting absolute paths in skill diagnostics", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-skill-"))
    const brokenDir = path.join(workspace, ".agents", "skills", "broken")
    const brokenSkillPath = path.join(brokenDir, "SKILL.md")
    await fs.mkdir(brokenDir, { recursive: true })
    await fs.writeFile(brokenSkillPath, "This file cannot be read.")

    vi.spyOn(fs, "readFile").mockRejectedValue(
      new Error("Failed while resolving /wiki-ingest from /Users/example/.codex/skills/broken/SKILL.md"),
    )
    const logger = { warn: vi.fn() }
    const registry = new SkillRegistry({ projectId: "project-1", workspacePath: workspace, logger })

    await registry.list()

    expect(logger.warn).toHaveBeenCalledWith("Agent skill file skipped.", expect.objectContaining({
      skillName: "broken",
      error: "Failed while resolving /wiki-ingest from [path redacted]",
    }))
  })

  it("redacts secret-like values in skill file diagnostics", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-skill-"))
    const brokenDir = path.join(workspace, ".agents", "skills", "broken")
    const brokenSkillPath = path.join(brokenDir, "SKILL.md")
    await fs.mkdir(brokenDir, { recursive: true })
    await fs.writeFile(brokenSkillPath, "This file cannot be read.")

    vi.spyOn(fs, "readFile").mockRejectedValue(
      new Error("EACCES: token=sk-secret authorization=Bearer raw-token cookie=session=raw open /Users/example/.codex/skills/broken/SKILL.md"),
    )
    const logger = { warn: vi.fn() }
    const registry = new SkillRegistry({ projectId: "project-1", workspacePath: workspace, logger })

    await registry.list()

    expect(logger.warn).toHaveBeenCalledWith("Agent skill file skipped.", expect.objectContaining({
      skillName: "broken",
      error: "EACCES: token=[redacted] authorization=[redacted] cookie=[redacted] open [path redacted]",
    }))
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("raw-token")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("session=raw")
  })
})
