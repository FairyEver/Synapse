import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { discoverStagingSkillOverrides } from "../staging-skill-overrides"

describe("SY staging Skill overrides", () => {
  it("hides only managed staging aliases in config and project ancestors without changing files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sy-skill-overrides-"))
    try {
      const config = path.join(root, "config"), project = path.join(root, "project"), cwd = path.join(project, "nested")
      const entries = [path.join(config, "skills/.synapse-install-dir-Ab1234"), path.join(config, "skills/synapse-skill"), path.join(config, "skills/.custom-hidden"), path.join(project, ".claude/skills/.synapse-install-dir-Zz9876"), path.join(config, "skills/.synapse-install-dir-p123-Ab1234")]
      for (const dir of entries) { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, "SKILL.md"), "---\nname: synapse-skill\n---\nFixture") }
      await fs.mkdir(cwd, { recursive: true })
      expect(await discoverStagingSkillOverrides(cwd, config)).toEqual({ ".synapse-install-dir-Ab1234": "off", ".synapse-install-dir-Zz9876": "off", ".synapse-install-dir-p123-Ab1234": "off" })
      for (const dir of entries) expect(await fs.readFile(path.join(dir, "SKILL.md"), "utf8")).toBe("---\nname: synapse-skill\n---\nFixture")
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
  it("reports inaccessible directories without leaking their error text", async () => {
    const logger = { warn: vi.fn() }
    const spy = vi.spyOn(fs, "readdir").mockRejectedValueOnce(Object.assign(new Error("token=private-canary"), { code: "EACCES" }))
    try {
      expect(await discoverStagingSkillOverrides("/nonexistent-sy-project", "/nonexistent-sy-config", logger)).toEqual({})
      expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { boundary: "agent.skill.staging-discovery", errorCode: "EACCES" })
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("private-canary")
    } finally { spy.mockRestore() }
  })
  it("treats missing directories as no overrides", async () => {
    expect(await discoverStagingSkillOverrides("/nonexistent-sy-project/child", "/nonexistent-sy-config")).toEqual({})
  })
})
