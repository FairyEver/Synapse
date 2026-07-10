import { mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fsMocks = vi.hoisted(() => ({
  actualLstat: null as typeof import("node:fs/promises").lstat | null,
  actualOpen: null as typeof import("node:fs/promises").open | null,
  actualRealpath: null as typeof import("node:fs/promises").realpath | null,
  lstat: vi.fn<typeof import("node:fs/promises").lstat>(),
  open: vi.fn<typeof import("node:fs/promises").open>(),
  realpath: vi.fn<typeof import("node:fs/promises").realpath>(),
}))

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  fsMocks.actualLstat = actual.lstat
  fsMocks.actualOpen = actual.open
  fsMocks.actualRealpath = actual.realpath
  fsMocks.lstat.mockImplementation(actual.lstat)
  fsMocks.open.mockImplementation(actual.open)
  fsMocks.realpath.mockImplementation(actual.realpath)
  return {
    ...actual,
    lstat: fsMocks.lstat,
    open: fsMocks.open,
    realpath: fsMocks.realpath,
  }
})

import { materializeSkillEnv } from "../skill-env-materializer"
import { replaceDirectoryAtomically } from "../../editor-file-write-utils"

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

async function replaceWithMaterializedEnv(
  targetPath: string,
  mutateAfterMaterialize: () => Promise<void>,
): Promise<void> {
  let guard: { validate(): Promise<void> } | null = null

  await replaceDirectoryAtomically(
    targetPath,
    async (stagingDirectoryPath) => {
      await writeFile(path.join(stagingDirectoryPath, ".env.example"), "TOKEN=\n", "utf8")
      await materializeSkillEnv({
        stagingDirectoryPath,
        existingTargetDirectoryPath: targetPath,
        values: { TOKEN: "confirmed" },
        registerPrecondition(nextGuard) {
          guard = nextGuard
        },
      })
      await mutateAfterMaterialize()
    },
    {
      beforeSwap: async () => {
        if (!guard) throw new Error("Skill .env 更新前置校验未注册。")
        await guard.validate()
      },
    },
  )
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

beforeEach(() => {
  fsMocks.lstat.mockReset()
  fsMocks.open.mockReset()
  fsMocks.realpath.mockReset()
  fsMocks.lstat.mockImplementation(fsMocks.actualLstat!)
  fsMocks.open.mockImplementation(fsMocks.actualOpen!)
  fsMocks.realpath.mockImplementation(fsMocks.actualRealpath!)
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
      .resolves.toBe("TOKEN=old\nCUSTOM=user-only\nNEW_KEY=default\n")
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
      .resolves.toBe("TOKEN=old\r\nCUSTOM=user-only\r\nNEW_KEY=default\r\n")
  })

  it("preserves exact existing .env bytes when the staged example is missing", async () => {
    const paths = await createDirectories()
    const existing = Buffer.from([0x54, 0x4f, 0x4b, 0x45, 0x4e, 0x3d, 0xff, 0x0d, 0x0a])
    await writeFile(path.join(paths.existingTargetDirectoryPath, ".env"), existing)

    await expect(materializeSkillEnv({ ...paths, values: { TOKEN: "replacement" } }))
      .resolves.toBe("merged")
    await expect(readFile(path.join(paths.stagingDirectoryPath, ".env")))
      .resolves.toEqual(existing)
  })

  it("preserves existing declared values and uses submitted values only for new declarations", async () => {
    const paths = await createDirectories()
    await writeFile(
      path.join(paths.existingTargetDirectoryPath, ".env"),
      "TOKEN=existing\nCUSTOM=user-only\n",
      "utf8",
    )
    await writeFile(
      path.join(paths.stagingDirectoryPath, ".env.example"),
      "TOKEN=default\nNEW_KEY=default\nEMPTY=\n",
      "utf8",
    )

    await materializeSkillEnv({
      ...paths,
      values: { TOKEN: "submitted", NEW_KEY: "confirmed", EMPTY: "filled" },
    })

    await expect(readFile(path.join(paths.stagingDirectoryPath, ".env"), "utf8"))
      .resolves.toBe(
        "TOKEN=existing\nCUSTOM=user-only\nNEW_KEY=\"confirmed\"\nEMPTY=\"filled\"\n",
      )
  })

  it("returns absent without creating .env when the example is missing", async () => {
    const paths = await createDirectories()

    await expect(materializeSkillEnv({ ...paths, values: { TOKEN: "secret" } }))
      .resolves.toBe("absent")
    await expect(readFile(path.join(paths.stagingDirectoryPath, ".env"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rejects a source-supplied runtime .env already present in staging", async () => {
    const paths = await createDirectories()
    await writeFile(path.join(paths.stagingDirectoryPath, ".env.example"), "TOKEN=\n", "utf8")
    await writeFile(path.join(paths.stagingDirectoryPath, ".env"), "TOKEN=source-secret\n", "utf8")

    await expect(materializeSkillEnv({ ...paths, values: { TOKEN: "confirmed" } }))
      .rejects.toThrow("Skill 源目录不能包含 .env，请只提交 .env.example。")
  })

  it("rejects an existing target directory symlink without importing its .env", async () => {
    const paths = await createDirectories()
    const outsideDirectoryPath = path.join(path.dirname(paths.existingTargetDirectoryPath), "outside")
    await mkdir(outsideDirectoryPath)
    await writeFile(path.join(outsideDirectoryPath, ".env"), "TOKEN=outside\n", "utf8")
    await rm(paths.existingTargetDirectoryPath, { recursive: true })
    await symlink(outsideDirectoryPath, paths.existingTargetDirectoryPath, "dir")
    await writeFile(path.join(paths.stagingDirectoryPath, ".env.example"), "TOKEN=\n", "utf8")

    await expect(materializeSkillEnv({ ...paths, values: {} }))
      .rejects.toThrow("Skill 目标目录不能是符号链接。")
    await expect(readFile(path.join(paths.stagingDirectoryPath, ".env"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" })
  })

  it("fails closed when the existing target directory is replaced during validation", async () => {
    const paths = await createDirectories()
    const originalDirectoryPath = `${paths.existingTargetDirectoryPath}-original`
    const outsideDirectoryPath = path.join(path.dirname(paths.existingTargetDirectoryPath), "race-outside")
    await mkdir(outsideDirectoryPath)
    await writeFile(path.join(paths.existingTargetDirectoryPath, ".env"), "TOKEN=inside\n", "utf8")
    await writeFile(path.join(outsideDirectoryPath, ".env"), "TOKEN=outside\n", "utf8")
    await writeFile(path.join(paths.stagingDirectoryPath, ".env.example"), "TOKEN=\n", "utf8")
    fsMocks.realpath.mockImplementationOnce(async (targetPath) => {
      const resolved = await fsMocks.actualRealpath!(targetPath)
      await rename(paths.existingTargetDirectoryPath, originalDirectoryPath)
      await symlink(outsideDirectoryPath, paths.existingTargetDirectoryPath, "dir")
      return resolved
    })

    await expect(materializeSkillEnv({ ...paths, values: {} }))
      .rejects.toThrow(/目标目录.*变化|目标目录不能是符号链接/)
    await expect(readFile(path.join(paths.stagingDirectoryPath, ".env"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" })
    await expect(readFile(path.join(outsideDirectoryPath, ".env"), "utf8"))
      .resolves.toBe("TOKEN=outside\n")
    await expect(realpath(paths.existingTargetDirectoryPath))
      .resolves.toBe(await realpath(outsideDirectoryPath))
  })

  it("rejects a target that appears after materialization but before the directory swap", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-env-swap-"))
    tempRoots.push(root)
    const targetPath = path.join(root, "skill")

    await expect(replaceWithMaterializedEnv(targetPath, async () => {
      await mkdir(targetPath)
      await writeFile(path.join(targetPath, "marker.txt"), "outside", "utf8")
    })).rejects.toThrow("Skill 目标目录在读取 .env 期间发生变化。")

    await expect(readFile(path.join(targetPath, "marker.txt"), "utf8")).resolves.toBe("outside")
  })

  it("rejects an .env that appears after an existing target was materialized without one", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-env-swap-"))
    tempRoots.push(root)
    const targetPath = path.join(root, "skill")
    await mkdir(targetPath)

    await expect(replaceWithMaterializedEnv(targetPath, async () => {
      await writeFile(path.join(targetPath, ".env"), "TOKEN=outside\n", "utf8")
    })).rejects.toThrow("Skill .env 在读取期间发生变化。")

    await expect(readFile(path.join(targetPath, ".env"), "utf8")).resolves.toBe("TOKEN=outside\n")
  })

  it("rejects an existing .env that is replaced after materialization", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-env-swap-"))
    tempRoots.push(root)
    const targetPath = path.join(root, "skill")
    const envPath = path.join(targetPath, ".env")
    await mkdir(targetPath)
    await writeFile(envPath, "TOKEN=original\n", "utf8")

    await expect(replaceWithMaterializedEnv(targetPath, async () => {
      await rename(envPath, path.join(targetPath, ".env-original"))
      await writeFile(envPath, "TOKEN=replacement\n", "utf8")
    })).rejects.toThrow("Skill .env 在读取期间发生变化。")

    await expect(readFile(envPath, "utf8")).resolves.toBe("TOKEN=replacement\n")
  })

  it("rejects existing .env content changed in place after materialization", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-env-swap-"))
    tempRoots.push(root)
    const targetPath = path.join(root, "skill")
    const envPath = path.join(targetPath, ".env")
    await mkdir(targetPath)
    await writeFile(envPath, "TOKEN=original\n", "utf8")

    await expect(replaceWithMaterializedEnv(targetPath, async () => {
      await writeFile(envPath, "TOKEN=changed-in-place\n", "utf8")
    })).rejects.toThrow("Skill .env 在读取期间发生变化。")

    await expect(readFile(envPath, "utf8")).resolves.toBe("TOKEN=changed-in-place\n")
  })

  it("rejects an existing target directory replaced after materialization", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-env-swap-"))
    tempRoots.push(root)
    const targetPath = path.join(root, "skill")
    const originalTargetPath = path.join(root, "skill-original")
    await mkdir(targetPath)
    await writeFile(path.join(targetPath, ".env"), "TOKEN=original\n", "utf8")

    await expect(replaceWithMaterializedEnv(targetPath, async () => {
      await rename(targetPath, originalTargetPath)
      await mkdir(targetPath)
      await writeFile(path.join(targetPath, ".env"), "TOKEN=replacement\n", "utf8")
    })).rejects.toThrow("Skill 目标目录在读取 .env 期间发生变化。")

    await expect(readFile(path.join(targetPath, ".env"), "utf8"))
      .resolves.toBe("TOKEN=replacement\n")
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
