import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { codexAdapter } from "../adapter"

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  delete process.env.CODEX_HOME
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Codex editor adapter", () => {
  it("targets an owned Skill in the compatibility root before a primary same-name conflict", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-codex-adapter-"))
    roots.push(root)
    vi.spyOn(os, "homedir").mockReturnValue(root)
    process.env.CODEX_HOME = path.join(root, ".codex")
    const primarySkill = path.join(root, ".agents", "skills", "synapse-skill")
    const compatSkill = path.join(root, ".codex", "skills", "synapse-skill")
    await mkdir(primarySkill, { recursive: true })
    await mkdir(compatSkill, { recursive: true })
    await writeFile(path.join(primarySkill, ".synapse.json"), JSON.stringify({ id: "external-skill" }))
    await writeFile(path.join(compatSkill, ".synapse.json"), JSON.stringify({ id: "synapse-skill" }))

    await expect(codexAdapter.resolveGlobalTarget({
      contentId: "synapse-skill",
      contentType: "skill",
      skillName: "synapse-skill",
      skillTitle: "Synapse Skill",
    })).resolves.toMatchObject({
      status: "ready",
      targetPath: compatSkill,
      ownedTargetExists: true,
    })
  })
})
