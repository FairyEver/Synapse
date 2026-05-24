import { app } from "electron"
import os from "node:os"
import path from "node:path"
import type { SynapseProjectConfig } from "../../../src/types/config"

const RUNTIME_ID_PATTERN = /^[A-Za-z0-9_-]+$/

export function knowledgeBaseVirtualPath(runtimeId: string): string {
  return `synapse-kb://${runtimeId}`
}

export function isManagedKnowledgeBaseProject(project: SynapseProjectConfig | null | undefined): boolean {
  return project?.capabilities?.knowledgeBase?.enabled === true
    && project.capabilities.knowledgeBase.managed === true
    && typeof project.capabilities.knowledgeBase.runtimeId === "string"
    && RUNTIME_ID_PATTERN.test(project.capabilities.knowledgeBase.runtimeId)
}

export function resolveManagedKnowledgeBasePath(
  project: SynapseProjectConfig,
  userDataPath = defaultKnowledgeBaseUserDataPath(),
): string {
  const runtimeId = project.capabilities?.knowledgeBase?.runtimeId
  if (!runtimeId || !RUNTIME_ID_PATTERN.test(runtimeId)) {
    throw new Error("Invalid managed knowledge base runtime id.")
  }
  return path.join(userDataPath, "knowledge-bases", runtimeId)
}

export function resolveProjectWorkspacePath(
  project: SynapseProjectConfig,
  userDataPath?: string,
): string {
  return isManagedKnowledgeBaseProject(project)
    ? resolveManagedKnowledgeBasePath(project, userDataPath ?? defaultKnowledgeBaseUserDataPath())
    : project.path
}

export function defaultKnowledgeBaseUserDataPath(): string {
  const electronApp = app as { getPath?: (name: string) => string } | undefined
  return electronApp?.getPath?.("userData") ?? path.join(os.tmpdir(), "synapse-userData")
}
