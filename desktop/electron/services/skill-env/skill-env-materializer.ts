import { constants } from "node:fs"
import { lstat, open, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  SKILL_ENV_EXAMPLE_PATH,
  SKILL_RUNTIME_ENV_PATH,
} from "../../../src/lib/content-attachments"
import { createDotenvFromExample, mergeDotenvExample } from "./dotenv-document"

export type MaterializeSkillEnvInput = {
  readonly stagingDirectoryPath: string
  readonly existingTargetDirectoryPath: string
  readonly values: Readonly<Record<string, string>>
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "ENOENT"
}

function isSymlinkOpenError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && (error.code === "ELOOP" || error.code === "EMLINK")
}

function createChangedEnvError(): Error {
  return new Error("Skill .env 在读取期间发生变化。")
}

function assertRegularEnvEntry(entry: { isFile(): boolean; isSymbolicLink(): boolean }): void {
  if (entry.isSymbolicLink()) {
    throw new Error("Skill .env 不能是符号链接。")
  }
  if (!entry.isFile()) {
    throw new Error("Skill .env 必须是普通文件。")
  }
}

async function readExistingEnv(existingEnvPath: string): Promise<string | null> {
  try {
    assertRegularEnvEntry(await lstat(existingEnvPath))
  } catch (error) {
    if (isMissingPathError(error)) return null
    throw error
  }

  let handle
  try {
    const noFollowFlag = typeof constants.O_NOFOLLOW === "number"
      ? constants.O_NOFOLLOW
      : 0
    const nonBlockingFlag = typeof constants.O_NONBLOCK === "number"
      ? constants.O_NONBLOCK
      : 0
    handle = await open(
      existingEnvPath,
      constants.O_RDONLY | noFollowFlag | nonBlockingFlag,
    )
  } catch (error) {
    if (isSymlinkOpenError(error)) {
      throw new Error("Skill .env 不能是符号链接。")
    }
    if (isMissingPathError(error)) throw createChangedEnvError()
    throw error
  }

  try {
    const openedEntry = await handle.stat({ bigint: true })
    if (!openedEntry.isFile()) {
      throw new Error("Skill .env 必须是普通文件。")
    }

    let currentEntry
    try {
      currentEntry = await lstat(existingEnvPath, { bigint: true })
    } catch (error) {
      if (isMissingPathError(error)) throw createChangedEnvError()
      throw error
    }
    assertRegularEnvEntry(currentEntry)

    if (openedEntry.ino === 0n || currentEntry.ino === 0n) {
      throw new Error("Skill .env 文件身份无法安全确认。")
    }
    if (openedEntry.dev !== currentEntry.dev || openedEntry.ino !== currentEntry.ino) {
      throw createChangedEnvError()
    }

    return await handle.readFile("utf8")
  } finally {
    await handle.close()
  }
}

export async function materializeSkillEnv(
  input: MaterializeSkillEnvInput,
): Promise<"created" | "merged" | "absent"> {
  const stagedExamplePath = path.join(input.stagingDirectoryPath, SKILL_ENV_EXAMPLE_PATH)
  const stagedEnvPath = path.join(input.stagingDirectoryPath, SKILL_RUNTIME_ENV_PATH)
  const existingEnvPath = path.join(input.existingTargetDirectoryPath, SKILL_RUNTIME_ENV_PATH)

  let example: string
  try {
    example = await readFile(stagedExamplePath, "utf8")
  } catch (error) {
    if (isMissingPathError(error)) return "absent"
    throw error
  }

  const existing = await readExistingEnv(existingEnvPath)

  const content = existing === null
    ? createDotenvFromExample(example, input.values)
    : mergeDotenvExample(existing, example, input.values)
  await writeFile(stagedEnvPath, content, "utf8")
  return existing === null ? "created" : "merged"
}
