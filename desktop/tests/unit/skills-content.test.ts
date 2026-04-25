import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  buildSkillInvocationPrompt,
  computeClaudeSkillDirs,
  computeCodexSkillDirs,
  discoverSkillsFromDirectories,
  parseSkillMarkdown,
  resolveSkillByName,
} from "../../electron/services/skills-content-service"

const tempRoots: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-skills-"))
  tempRoots.push(dir)
  return dir
}

function writeSkill(filePath: string, raw: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, raw)
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true })
  }
})

describe("skills content compatibility", () => {
  it("parses SKILL.md frontmatter and builds invocation prompts", () => {
    const skill = parseSkillMarkdown("calendar-scheduler", `---
name: Calendar Scheduler
description: >-
  Schedule
  calendar tasks
version: 1.2.3
---
Follow the calendar workflow.`, "/skills/calendar-scheduler")

    expect(skill).toMatchObject({
      name: "calendar-scheduler",
      displayName: "Calendar Scheduler",
      description: "Schedule calendar tasks",
      version: "1.2.3",
      prompt: "Follow the calendar workflow.",
      source: "/skills/calendar-scheduler",
    })
    expect(buildSkillInvocationPrompt(skill!, ["today"])).toContain("## User Arguments:\ntoday")
  })

  it("discovers grouped skills, follows directory symlinks, dedupes leaf names, and ignores root SKILL.md", async () => {
    const root = tempDir()
    const targetRoot = tempDir()
    writeSkill(path.join(root, "SKILL.md"), "Root skill should be ignored")
    writeSkill(path.join(root, "automation", "telegram-codex-bot", "SKILL.md"), "---\ndescription: Telegram bot skill\n---\nPrompt body")
    writeSkill(path.join(root, "productivity", "doc", "SKILL.md"), "Doc skill")
    writeSkill(path.join(root, "apple", "helper", "SKILL.md"), "Apple helper")
    writeSkill(path.join(root, "automation", "helper", "SKILL.md"), "Automation helper")
    writeSkill(path.join(targetRoot, "research", "hf-papers", "SKILL.md"), "HF papers skill")
    fs.symlinkSync(path.join(targetRoot, "research"), path.join(root, "research"))
    fs.symlinkSync(path.join(root, "automation"), path.join(root, "automation", "again"))

    const skills = await discoverSkillsFromDirectories([root])

    expect(skills.map((skill) => skill.name)).toEqual([
      "helper",
      "telegram-codex-bot",
      "doc",
      "hf-papers",
    ])
    expect(resolveSkillByName(skills, "telegram_codex_bot")).toMatchObject({ name: "telegram-codex-bot" })
    expect(resolveSkillByName(skills, "missing")).toBeNull()
  })

  it("computes Claude and Codex project/user skill directories", () => {
    const tmp = tempDir()
    const home = path.join(tmp, "home")
    const repo = path.join(tmp, "repo")
    const workDir = path.join(repo, "nested", "pkg")
    const claudeConfigDir = path.join(tmp, "profile-home")
    const codexHome = path.join(tmp, "codex-home")

    expect(computeClaudeSkillDirs({
      workDir,
      homeDir: home,
      claudeConfigDir,
      markerDirs: [repo],
    })).toEqual([
      path.join(workDir, ".claude", "skills"),
      path.join(repo, "nested", ".claude", "skills"),
      path.join(repo, ".claude", "skills"),
      path.join(claudeConfigDir, "skills"),
    ])

    expect(computeCodexSkillDirs({
      workDir,
      homeDir: home,
      codexHome,
      markerDirs: [repo],
    })).toEqual([
      path.join(workDir, ".agents", "skills"),
      path.join(workDir, ".codex", "skills"),
      path.join(repo, "nested", ".agents", "skills"),
      path.join(repo, "nested", ".codex", "skills"),
      path.join(repo, ".agents", "skills"),
      path.join(repo, ".codex", "skills"),
      path.join(codexHome, "skills"),
      path.join(home, ".agents", "skills"),
    ])
  })
})
