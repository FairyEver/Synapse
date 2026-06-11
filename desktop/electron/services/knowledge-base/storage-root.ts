import path from "node:path"
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

export function isPathInside(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath))
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}

export type { KnowledgeBaseStorageRootInput }
