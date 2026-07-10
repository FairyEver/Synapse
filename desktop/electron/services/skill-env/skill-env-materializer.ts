import { lstat, readFile, writeFile } from "node:fs/promises"
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

  let existing: string | null = null
  try {
    const entry = await lstat(existingEnvPath)
    if (entry.isSymbolicLink()) {
      throw new Error("Skill .env 不能是符号链接。")
    }
    existing = await readFile(existingEnvPath, "utf8")
  } catch (error) {
    if (!isMissingPathError(error)) throw error
  }

  const content = existing === null
    ? createDotenvFromExample(example, input.values)
    : mergeDotenvExample(existing, example, input.values)
  await writeFile(stagedEnvPath, content, "utf8")
  return existing === null ? "created" : "merged"
}
