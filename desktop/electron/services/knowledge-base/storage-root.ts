import path from "node:path"
import { constants } from "node:fs"
import { access, lstat } from "node:fs/promises"
import type { SynapseKnowledgeBaseStorageConfig } from "../../../src/types/config"

type KnowledgeBaseStorageRootInput = {
  userDataPath: string
  storage: SynapseKnowledgeBaseStorageConfig
}

export function resolveKnowledgeBaseStorageRoot(input: KnowledgeBaseStorageRootInput): string {
  return input.storage.mode === "custom"
    ? path.resolve(input.storage.rootPath)
    : input.userDataPath
}

export function resolveKnowledgeBasesDirectory(input: KnowledgeBaseStorageRootInput): string {
  return path.join(resolveKnowledgeBaseStorageRoot(input), "knowledge-bases")
}

export async function assertKnowledgeBaseStorageAvailable(input: KnowledgeBaseStorageRootInput): Promise<void> {
  const rootPath = resolveKnowledgeBaseStorageRoot(input)
  await access(rootPath, constants.R_OK | constants.W_OK)

  if (input.storage.mode !== "custom") return

  const knowledgeBasesPath = resolveKnowledgeBasesDirectory(input)
  const knowledgeBasesStat = await lstat(knowledgeBasesPath)
  if (knowledgeBasesStat.isSymbolicLink()) {
    throw new Error("知识库数据目录不能是符号链接。")
  }
  if (!knowledgeBasesStat.isDirectory()) {
    throw new Error("知识库数据目录不是文件夹。")
  }
  await access(knowledgeBasesPath, constants.R_OK | constants.W_OK)
}

export function isPathInside(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath))
  return relative === "" || (!!relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

export type { KnowledgeBaseStorageRootInput }
