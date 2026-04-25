import path from "node:path"
import type {
  SynapseLegacyCcProjectPreview,
  SynapseProjectConfig,
  SynapseWorkspaceBinding,
} from "../../src/types/config"

export type ProjectPathStatus = "valid" | "missing" | "not-directory" | "unknown"

export type ProjectPathInspection = {
  path: string
  status: ProjectPathStatus
}

export type ProjectWorkspaceDraft = {
  projects: SynapseProjectConfig[]
  defaultProjectId: string | null
  issues: string[]
}

export type WorkspaceBindingInput = {
  projectId: string | null
  platform: string
  channelId: string
  channelName: string
  workspacePath: string
  boundAt?: string
}

export type WorkspaceResolution = {
  binding: SynapseWorkspaceBinding | null
  source: "project" | "shared" | null
}

export type ProjectPathInspector = (workspacePath: string) => Promise<ProjectPathStatus> | ProjectPathStatus

const DEFAULT_PROJECT_ID_PREFIX = "cc-project"

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function stableHash(value: string): string {
  let hash = 0

  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }

  return hash.toString(36)
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return slug || DEFAULT_PROJECT_ID_PREFIX
}

function projectIdFor(name: string, index: number): string {
  return `${slugify(name)}-${stableHash(`${index}:${name}`)}`
}

export function workspaceChannelKey(platform: string, channelId: string): string {
  return `${platform}:${channelId}`
}

function legacyWorkspaceChannelKey(channelKey: string): string {
  const separatorIndex = channelKey.indexOf(":")
  return separatorIndex >= 0 ? channelKey.slice(separatorIndex + 1) : channelKey
}

function workspaceChannelKeyCandidates(channelKey: string): string[] {
  if (!channelKey) {
    return []
  }

  const legacyKey = legacyWorkspaceChannelKey(channelKey)
  return legacyKey === channelKey ? [channelKey] : [channelKey, legacyKey]
}

export function normalizeWorkspacePath(workspacePath: string): string {
  return path.normalize(workspacePath.trim())
}

export function createProjectWorkspaceDraft(
  projects: readonly SynapseLegacyCcProjectPreview[],
  options: { defaultProjectName?: string } = {},
): ProjectWorkspaceDraft {
  const issues: string[] = []
  const normalizedProjects = projects.flatMap((project, index): SynapseProjectConfig[] => {
    const mode = project.mode === "multi-workspace" ? "multi-workspace" : "single"
    const projectPath = mode === "multi-workspace" ? project.baseDir : project.workDir

    if (!isNonEmptyString(project.name)) {
      issues.push(`projects[${index}].name is required`)
      return []
    }

    if (!isNonEmptyString(projectPath)) {
      issues.push(`project ${JSON.stringify(project.name)} needs ${mode === "multi-workspace" ? "base_dir" : "work_dir"}`)
      return []
    }

    const normalizedPath = normalizeWorkspacePath(projectPath)

    return [{
      id: projectIdFor(project.name, index),
      name: project.name.trim(),
      path: normalizedPath,
      mode,
      source: "cc-connect",
      ...(mode === "multi-workspace"
        ? { baseDir: normalizedPath }
        : { workDir: normalizedPath }),
    }]
  })

  const requestedDefault = options.defaultProjectName?.trim()
  const defaultProject =
    normalizedProjects.find((project) => project.name === requestedDefault)
    ?? normalizedProjects[0]
    ?? null

  return {
    projects: normalizedProjects,
    defaultProjectId: defaultProject?.id ?? null,
    issues,
  }
}

export function setProjectWorkDirOverride(
  project: SynapseProjectConfig,
  workDir: string,
): SynapseProjectConfig {
  const normalizedWorkDir = normalizeWorkspacePath(workDir)

  return {
    ...project,
    path: normalizedWorkDir,
    workDirOverride: normalizedWorkDir,
  }
}

export function clearProjectWorkDirOverride(project: SynapseProjectConfig): SynapseProjectConfig {
  const defaultPath = project.mode === "multi-workspace"
    ? project.baseDir ?? project.path
    : project.workDir ?? project.path

  return {
    ...project,
    path: defaultPath,
    workDirOverride: undefined,
  }
}

export function setWorkspaceDirOverride(
  project: SynapseProjectConfig,
  workspacePath: string,
  workDir: string,
): SynapseProjectConfig {
  const workspaceKey = normalizeWorkspacePath(workspacePath)
  const normalizedWorkDir = normalizeWorkspacePath(workDir)

  return {
    ...project,
    workspaceDirOverrides: {
      ...project.workspaceDirOverrides,
      [workspaceKey]: normalizedWorkDir,
    },
  }
}

export function clearWorkspaceDirOverride(
  project: SynapseProjectConfig,
  workspacePath: string,
): SynapseProjectConfig {
  const workspaceKey = normalizeWorkspacePath(workspacePath)
  const { [workspaceKey]: _removed, ...remaining } = project.workspaceDirOverrides ?? {}
  void _removed

  return {
    ...project,
    ...(Object.keys(remaining).length > 0
      ? { workspaceDirOverrides: remaining }
      : { workspaceDirOverrides: undefined }),
  }
}

export function bindWorkspace(
  bindings: readonly SynapseWorkspaceBinding[],
  input: WorkspaceBindingInput,
): SynapseWorkspaceBinding[] {
  const channelKey = workspaceChannelKey(input.platform, input.channelId)
  const id = `${input.projectId ?? "shared"}:${channelKey}`
  const nextBinding: SynapseWorkspaceBinding = {
    id,
    projectId: input.projectId,
    channelKey,
    channelName: input.channelName,
    workspacePath: normalizeWorkspacePath(input.workspacePath),
    boundAt: input.boundAt ?? new Date().toISOString(),
  }

  return [
    ...bindings.filter((binding) => binding.id !== id),
    nextBinding,
  ]
}

export function unbindWorkspace(
  bindings: readonly SynapseWorkspaceBinding[],
  projectId: string | null,
  channelKey: string,
): SynapseWorkspaceBinding[] {
  const candidates = new Set(workspaceChannelKeyCandidates(channelKey))

  return bindings.filter((binding) =>
    binding.projectId !== projectId || !candidates.has(binding.channelKey)
  )
}

function findBinding(
  bindings: readonly SynapseWorkspaceBinding[],
  projectId: string | null,
  channelKey: string,
): SynapseWorkspaceBinding | null {
  const candidates = new Set(workspaceChannelKeyCandidates(channelKey))

  return bindings.find((binding) =>
    binding.projectId === projectId && candidates.has(binding.channelKey)
  ) ?? null
}

export function lookupEffectiveWorkspaceBinding(
  bindings: readonly SynapseWorkspaceBinding[],
  projectId: string,
  channelKey: string,
): WorkspaceResolution {
  const projectBinding = findBinding(bindings, projectId, channelKey)

  if (projectBinding) {
    return { binding: projectBinding, source: "project" }
  }

  const sharedBinding = findBinding(bindings, null, channelKey)

  if (sharedBinding) {
    return { binding: sharedBinding, source: "shared" }
  }

  return { binding: null, source: null }
}

export async function inspectProjectPath(
  project: SynapseProjectConfig,
  inspector: ProjectPathInspector,
): Promise<ProjectPathInspection> {
  const status = await inspector(project.path)

  return {
    path: project.path,
    status,
  }
}
