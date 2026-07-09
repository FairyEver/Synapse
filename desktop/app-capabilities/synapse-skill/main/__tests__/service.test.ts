import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SYNAPSE_SKILL_SOURCE_IDENTITY } from "../../shared/capability"
import { createSynapseSkillService } from "../service"

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => os.tmpdir(),
    isPackaged: false,
  },
}))

const roots: string[] = []

async function createPackageRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-package-"))
  roots.push(root)
  await mkdir(path.join(root, "database"), { recursive: true })
  await writeFile(
    path.join(root, "SKILL.md"),
    "---\nname: synapse-skill\ndescription: Test\n---\n# Synapse Skill\n",
    "utf8",
  )
  await writeFile(path.join(root, "database", "index.md"), "# Database\n", "utf8")
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("SynapseSkillService", () => {
  it("prepares a stable system installer source", async () => {
    const packageRoot = await createPackageRoot()
    const service = createSynapseSkillService({ packageRoot })

    const source = await service.prepareInstallSource()

    expect(source).toMatchObject({
      kind: "skill",
      origin: "prepared",
      sourceIdentity: SYNAPSE_SKILL_SOURCE_IDENTITY,
      name: "synapse-skill",
      title: "Synapse Skill",
    })
    expect(source.preparedSourceId).toMatch(/^synapse-skill:/)
    expect(source.mainContent).toContain("# Synapse Skill")
    expect(source.sourceFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it("reads prepared skill detail with nested attachments", async () => {
    const packageRoot = await createPackageRoot()
    const service = createSynapseSkillService({ packageRoot })
    const source = await service.prepareInstallSource()

    const detail = await service.readPreparedSkill(source.preparedSourceId, source.sourceIdentity)

    expect(detail.id).toBe("synapse-skill")
    expect(detail.name).toBe("synapse-skill")
    expect(detail.content).toBe("# Synapse Skill")
    expect((detail as typeof detail & { sourceFingerprint?: string }).sourceFingerprint)
      .toBe(source.sourceFingerprint)
    expect(detail.attachments.map((item) => item.originalName)).toContain("database/index.md")
  })

  it("copies prepared skill attachments", async () => {
    const packageRoot = await createPackageRoot()
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-output-"))
    roots.push(outputRoot)
    const service = createSynapseSkillService({ packageRoot })
    const source = await service.prepareInstallSource()
    const targetPath = path.join(outputRoot, "database", "index.md")

    await service.copyPreparedSkillAttachment(
      source.preparedSourceId,
      source.sourceIdentity,
      "database/index.md",
      targetPath,
    )

    await expect(readFile(targetPath, "utf8")).resolves.toBe("# Database\n")
  })
})
