import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fsMocks = vi.hoisted(() => ({
  actualLstat: null as typeof import("node:fs/promises").lstat | null,
  actualOpen: null as typeof import("node:fs/promises").open | null,
  lstat: vi.fn<typeof import("node:fs/promises").lstat>(),
  open: vi.fn<typeof import("node:fs/promises").open>(),
}))

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  fsMocks.actualLstat = actual.lstat
  fsMocks.actualOpen = actual.open
  fsMocks.lstat.mockImplementation(actual.lstat)
  fsMocks.open.mockImplementation(actual.open)
  return {
    ...actual,
    lstat: fsMocks.lstat,
    open: fsMocks.open,
  }
})

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

beforeEach(() => {
  fsMocks.lstat.mockReset()
  fsMocks.open.mockReset()
  fsMocks.lstat.mockImplementation(fsMocks.actualLstat!)
  fsMocks.open.mockImplementation(fsMocks.actualOpen!)
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

  it("rejects an existing non-regular .env entry", async () => {
    const paths = await createDirectories()
    await mkdir(path.join(paths.existingTargetDirectoryPath, ".env"))
    await writeFile(path.join(paths.stagingDirectoryPath, ".env.example"), "TOKEN=\n", "utf8")

    await expect(materializeSkillEnv({
      ...paths,
      values: { TOKEN: "updated" },
    })).rejects.toThrow("Skill .env 必须是普通文件。")
  })

  it("opens the checked path without following links or blocking on special files when supported", async () => {
    const paths = await createDirectories()
    await writeFile(path.join(paths.existingTargetDirectoryPath, ".env"), "TOKEN=old\n", "utf8")
    await writeFile(path.join(paths.stagingDirectoryPath, ".env.example"), "TOKEN=\n", "utf8")

    await materializeSkillEnv({ ...paths, values: {} })

    const flags = fsMocks.open.mock.calls[0]?.[1]
    expect(typeof flags).toBe("number")
    if (constants.O_NOFOLLOW !== 0) {
      expect((flags as number) & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW)
    }
    if (constants.O_NONBLOCK !== 0) {
      expect((flags as number) & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK)
    }
  })

  it("does not follow a symlink installed after the initial path check", async () => {
    const paths = await createDirectories()
    const existingEnvPath = path.join(paths.existingTargetDirectoryPath, ".env")
    const linkedFilePath = path.join(path.dirname(paths.existingTargetDirectoryPath), "race-linked.env")
    await writeFile(existingEnvPath, "TOKEN=old\n", "utf8")
    await writeFile(linkedFilePath, "TOKEN=do-not-read\n", "utf8")
    await writeFile(path.join(paths.stagingDirectoryPath, ".env.example"), "TOKEN=\n", "utf8")
    fsMocks.lstat.mockImplementationOnce(async (targetPath, options) => {
      const entry = await fsMocks.actualLstat!(targetPath, options as never)
      await rm(existingEnvPath)
      await symlink(linkedFilePath, existingEnvPath)
      return entry as never
    })

    await expect(materializeSkillEnv({
      ...paths,
      values: { TOKEN: "updated" },
    })).rejects.toThrow("Skill .env 不能是符号链接。")
    await expect(readFile(linkedFilePath, "utf8")).resolves.toBe("TOKEN=do-not-read\n")
  })

  it("closes the opened file when the path becomes a symlink before reading", async () => {
    const paths = await createDirectories()
    const existingEnvPath = path.join(paths.existingTargetDirectoryPath, ".env")
    const linkedFilePath = path.join(path.dirname(paths.existingTargetDirectoryPath), "post-open-linked.env")
    await writeFile(existingEnvPath, "TOKEN=old\n", "utf8")
    await writeFile(linkedFilePath, "TOKEN=do-not-read\n", "utf8")
    await writeFile(path.join(paths.stagingDirectoryPath, ".env.example"), "TOKEN=\n", "utf8")
    let closeSpy: ReturnType<typeof vi.spyOn> | null = null
    fsMocks.open.mockImplementationOnce(async (...args) => {
      const handle = await fsMocks.actualOpen!(...args)
      closeSpy = vi.spyOn(handle, "close")
      await rm(existingEnvPath)
      await symlink(linkedFilePath, existingEnvPath)
      return handle
    })

    await expect(materializeSkillEnv({
      ...paths,
      values: { TOKEN: "updated" },
    })).rejects.toThrow("Skill .env 不能是符号链接。")
    expect(closeSpy).toHaveBeenCalledOnce()
    await expect(readFile(linkedFilePath, "utf8")).resolves.toBe("TOKEN=do-not-read\n")
  })
})
