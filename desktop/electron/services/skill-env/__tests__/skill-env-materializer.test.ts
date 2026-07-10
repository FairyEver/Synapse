import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { materializeSkillEnv } from "../skill-env-materializer"

const tempRoots: string[] = []

async function createDirectories(): Promise<{
  existingTargetDirectoryPath: string
  stagingDirectoryPath: string
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-env-materializer-"))
  tempRoots.push(root)
  const existingTargetDirectoryPath = path.join(root, "existing")
  const stagingDirectoryPath = path.join(root, "staging")
  await Promise.all([
    mkdir(existingTargetDirectoryPath, { recursive: true }),
    mkdir(stagingDirectoryPath, { recursive: true }),
  ])
  return { existingTargetDirectoryPath, stagingDirectoryPath }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("materializeSkillEnv", () => {
  it("creates .env from the staged example with exact bytes", async () => {
    const paths = await createDirectories()
    await writeFile(path.join(paths.stagingDirectoryPath, ".env.example"), "# config\nTOKEN=\nREGION=cn\n", "utf8")

    await expect(materializeSkillEnv({
      ...paths,
      values: { TOKEN: "secret value" },
    })).resolves.toBe("created")

    await expect(readFile(path.join(paths.stagingDirectoryPath, ".env"), "utf8"))
      .resolves.toBe("# config\nTOKEN=\"secret value\"\nREGION=cn\n")
  })

  it("merges into the staged file without mutating the existing target", async () => {
    const paths = await createDirectories()
    const existing = "TOKEN=old\nCUSTOM=user-only\n"
    await writeFile(path.join(paths.existingTargetDirectoryPath, ".env"), existing, "utf8")
    await writeFile(path.join(paths.stagingDirectoryPath, ".env.example"), "TOKEN=\nNEW_KEY=default\n", "utf8")

    await expect(materializeSkillEnv({
      ...paths,
      values: { TOKEN: "updated" },
    })).resolves.toBe("merged")

    await expect(readFile(path.join(paths.stagingDirectoryPath, ".env"), "utf8"))
      .resolves.toBe("TOKEN=\"updated\"\nCUSTOM=user-only\nNEW_KEY=default\n")
    await expect(readFile(path.join(paths.existingTargetDirectoryPath, ".env"), "utf8"))
      .resolves.toBe(existing)
  })

  it("preserves CRLF while appending example keys and retaining user-only keys", async () => {
    const paths = await createDirectories()
    await writeFile(
      path.join(paths.existingTargetDirectoryPath, ".env"),
      "TOKEN=old\r\nCUSTOM=user-only\r\n",
      "utf8",
    )
    await writeFile(
      path.join(paths.stagingDirectoryPath, ".env.example"),
      "TOKEN=\r\nNEW_KEY=default\r\n",
      "utf8",
    )

    await expect(materializeSkillEnv({
      ...paths,
      values: { TOKEN: "updated" },
    })).resolves.toBe("merged")

    await expect(readFile(path.join(paths.stagingDirectoryPath, ".env"), "utf8"))
      .resolves.toBe("TOKEN=\"updated\"\r\nCUSTOM=user-only\r\nNEW_KEY=default\r\n")
  })

  it("returns absent without creating .env when the example is missing", async () => {
    const paths = await createDirectories()

    await expect(materializeSkillEnv({ ...paths, values: { TOKEN: "secret" } }))
      .resolves.toBe("absent")
    await expect(readFile(path.join(paths.stagingDirectoryPath, ".env"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rejects an existing .env symlink without reading through or writing it", async () => {
    const paths = await createDirectories()
    const linkedFilePath = path.join(path.dirname(paths.existingTargetDirectoryPath), "linked.env")
    await writeFile(linkedFilePath, "TOKEN=do-not-read\n", "utf8")
    await symlink(linkedFilePath, path.join(paths.existingTargetDirectoryPath, ".env"))
    await writeFile(path.join(paths.stagingDirectoryPath, ".env.example"), "TOKEN=\n", "utf8")

    await expect(materializeSkillEnv({
      ...paths,
      values: { TOKEN: "updated" },
    })).rejects.toThrow("Skill .env 不能是符号链接。")
    await expect(readFile(linkedFilePath, "utf8")).resolves.toBe("TOKEN=do-not-read\n")
    await expect(readFile(path.join(paths.stagingDirectoryPath, ".env"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" })
  })
})
