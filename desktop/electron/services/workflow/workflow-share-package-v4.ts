import PizZip from "pizzip"
import { z } from "zod"
import {
  WORKFLOW_SHARE_PACKAGE_MAX_COMPRESSED_BYTES,
  WORKFLOW_SHARE_PACKAGE_MAX_COMPRESSION_RATIO,
  WORKFLOW_SHARE_PACKAGE_MAX_ENTRIES,
  WORKFLOW_SHARE_PACKAGE_MAX_FILE_BYTES,
  WORKFLOW_SHARE_PACKAGE_MAX_MANIFEST_BYTES,
  WORKFLOW_SHARE_PACKAGE_MAX_OCCURRENCES,
  WORKFLOW_SHARE_PACKAGE_MAX_PARSE_TIME_MS,
  WORKFLOW_SHARE_PACKAGE_MAX_UNCOMPRESSED_BYTES,
  WORKFLOW_SHARE_PACKAGE_MAX_WORKFLOWS,
} from "../../../config"
import type { WorkflowDefinition } from "../../../src/types/workflow"
import {
  SYNAPSE_WORKFLOW_PACKAGE_FORMAT,
  SYNAPSE_WORKFLOW_PACKAGE_FORMAT_VERSION,
  type WorkflowShareManifestV4,
  type WorkflowSharePackageV4,
} from "../../../src/types/workflow-package"
import { decodeUtf8, readZipEntries, sha256 } from "../install-package-utils"

const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/)
const fieldPathSchema = z.array(z.union([z.string(), z.number().int().nonnegative()]))
const fieldLocationSchema = z.object({
  workflowRef: z.string().min(1),
  nodeId: z.string().optional(),
  nodeName: z.string().optional(),
  nodeType: z.string().optional(),
  fieldPath: fieldPathSchema,
})
const diagnosticLocationSchema = fieldLocationSchema.extend({
  code: z.string().min(1),
  message: z.string().optional(),
})
const occurrenceSchema = fieldLocationSchema.extend({ inherited: z.boolean() })
const capabilitySchema = z.object({
  id: z.string().min(1),
  minVersion: semverSchema,
  installSourceId: z.string().min(1).optional(),
})

export const workflowShareManifestV4Schema = z.object({
  format: z.literal(SYNAPSE_WORKFLOW_PACKAGE_FORMAT),
  formatVersion: semverSchema,
  artifactId: z.string().min(1),
  lineageId: z.string().min(1),
  exportedAt: z.iso.datetime(),
  createdWith: z.object({
    appVersion: z.string().min(1),
    platform: z.enum(["darwin", "win32", "linux"]).optional(),
  }),
  derivedFrom: z.object({
    lineageId: z.string().min(1),
    artifactId: z.string().min(1).optional(),
  }).optional(),
  shareNote: z.string().max(20_000).optional(),
  entrypoints: z.array(z.string().min(1)).min(1),
  workflows: z.array(z.object({
    ref: z.string().min(1),
    sourceWorkflowId: z.string().min(1),
    sourceRevision: z.string().min(1),
    schemaVersion: semverSchema,
    path: z.string().min(1),
  })).min(1).max(WORKFLOW_SHARE_PACKAGE_MAX_WORKFLOWS),
  references: z.object({
    models: z.array(z.object({
      id: z.string().min(1),
      environment: z.enum(["synapse", "codex", "claude-code"]),
      sourceProviderId: z.string().optional(),
      sourceProviderName: z.string().optional(),
      sourceProviderCategory: z.string().optional(),
      sourceModelTier: z.enum(["default", "haiku", "sonnet", "opus"]).optional(),
      sourceModelName: z.string().optional(),
      missingOnExporter: z.boolean().optional(),
      occurrences: z.array(occurrenceSchema),
    })),
    projects: z.array(z.object({
      id: z.string().min(1),
      sourceProjectId: z.string().min(1).optional(),
      sourceProjectName: z.string().optional(),
      sourceProjectType: z.string().optional(),
      gitRemoteFingerprint: z.string().optional(),
      occurrences: z.array(occurrenceSchema),
    })),
    resources: z.array(z.object({
      id: z.string().min(1),
      kind: z.enum(["local_path", "drive", "staged", "inline_file"]),
      entryType: z.enum(["file", "directory"]),
      cardinality: z.enum(["one", "many"]),
      access: z.enum(["read", "write", "read-write"]),
      displayName: z.string().optional(),
      sourceIdentity: z.string().optional(),
      driveId: z.string().optional(),
      driveVersionId: z.string().optional(),
      occurrences: z.array(occurrenceSchema),
    })),
    environments: z.array(z.object({
      id: z.string().min(1),
      kind: z.string().min(1),
      sourceValue: z.string().optional(),
      occurrences: z.array(occurrenceSchema),
    })),
    runtimes: z.array(z.object({
      id: z.string().min(1),
      minVersion: semverSchema,
      occurrences: z.array(occurrenceSchema),
    })),
  }),
  requiredCapabilities: z.array(capabilitySchema),
  risks: z.object({
    sensitiveLocations: z.array(fieldLocationSchema),
    highRiskLocations: z.array(diagnosticLocationSchema),
    portabilityWarnings: z.array(diagnosticLocationSchema),
    excludedAutomationCount: z.number().int().nonnegative(),
  }),
  files: z.array(z.object({
    path: z.string().min(1),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    mediaType: z.string().min(1),
  })),
  extensions: z.record(z.string(), z.unknown()).optional(),
  signatures: z.array(z.record(z.string(), z.unknown())).optional(),
}).passthrough()

export interface WorkflowShareArchiveBuildInput {
  readonly manifest: Omit<WorkflowShareManifestV4, "files">
  readonly workflows: ReadonlyMap<string, WorkflowDefinition>
}

export interface WorkflowShareArchiveBuildResult {
  readonly bytes: Buffer
  readonly manifest: WorkflowShareManifestV4
}

export function buildWorkflowShareArchive(input: WorkflowShareArchiveBuildInput): WorkflowShareArchiveBuildResult {
  if (input.manifest.workflows.length > WORKFLOW_SHARE_PACKAGE_MAX_WORKFLOWS) {
    throw new Error("工作流分享包包含的工作流过多。")
  }
  const files = input.manifest.workflows.map((item) => {
    const workflow = input.workflows.get(item.ref)
    if (!workflow) throw new Error(`Missing workflow document for ${item.ref}`)
    if (workflow.id !== item.sourceWorkflowId || workflow.version !== item.sourceRevision) {
      throw new Error(`工作流身份或修订不一致：${item.ref}`)
    }
    if (workflow.meta?.schemaVersion !== item.schemaVersion) {
      throw new Error(`工作流 schema 版本不一致：${item.ref}`)
    }
    const bytes = Buffer.from(`${JSON.stringify(workflow, null, 2)}\n`, "utf8")
    if (bytes.length > WORKFLOW_SHARE_PACKAGE_MAX_FILE_BYTES) {
      throw new Error(`工作流文档超过大小限制：${item.ref}`)
    }
    return {
      descriptor: {
        path: item.path,
        size: bytes.length,
        sha256: sha256(bytes),
        mediaType: "application/vnd.synapse.workflow+json",
      },
      bytes,
    }
  })
  if (files.length + 1 > WORKFLOW_SHARE_PACKAGE_MAX_ENTRIES) {
    throw new Error("工作流分享包包含的文件过多。")
  }
  const manifest: WorkflowShareManifestV4 = workflowShareManifestV4Schema.parse({
    ...input.manifest,
    files: files.map((item) => item.descriptor),
  })
  assertManifestRelationships(manifest)

  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  if (manifestBytes.length > WORKFLOW_SHARE_PACKAGE_MAX_MANIFEST_BYTES) {
    throw new Error("工作流分享包 manifest 超过大小限制。")
  }
  const uncompressedBytes = manifestBytes.length + files.reduce((total, file) => total + file.bytes.length, 0)
  if (uncompressedBytes > WORKFLOW_SHARE_PACKAGE_MAX_UNCOMPRESSED_BYTES) {
    throw new Error("工作流分享包解压后超过大小限制。")
  }

  const zip = new PizZip()
  zip.file("manifest.json", manifestBytes, { binary: true, createFolders: false })
  for (const file of files) {
    zip.file(file.descriptor.path, file.bytes, { binary: true, createFolders: false })
  }
  const bytes = zip.generate({ type: "nodebuffer", compression: "DEFLATE", platform: "UNIX" })
  if (bytes.length > WORKFLOW_SHARE_PACKAGE_MAX_COMPRESSED_BYTES) {
    throw new Error("工作流分享包超过大小限制。")
  }
  readWorkflowShareArchive(bytes)
  return { bytes, manifest }
}

export function readWorkflowShareArchive(bytes: Buffer): WorkflowSharePackageV4 {
  if (bytes.length > WORKFLOW_SHARE_PACKAGE_MAX_COMPRESSED_BYTES) {
    throw new Error("工作流分享包超过大小限制。")
  }
  const entries = readZipEntries(bytes, {
    maxCompressedBytes: WORKFLOW_SHARE_PACKAGE_MAX_COMPRESSED_BYTES,
    maxEntries: WORKFLOW_SHARE_PACKAGE_MAX_ENTRIES,
    maxFileBytes: WORKFLOW_SHARE_PACKAGE_MAX_FILE_BYTES,
    maxManifestBytes: WORKFLOW_SHARE_PACKAGE_MAX_MANIFEST_BYTES,
    maxUncompressedBytes: WORKFLOW_SHARE_PACKAGE_MAX_UNCOMPRESSED_BYTES,
    maxCompressionRatio: WORKFLOW_SHARE_PACKAGE_MAX_COMPRESSION_RATIO,
    maxParseTimeMs: WORKFLOW_SHARE_PACKAGE_MAX_PARSE_TIME_MS,
  })
  const manifestEntry = entries.get("manifest.json")
  if (!manifestEntry) throw new Error("工作流分享包缺少 manifest.json。")
  if (manifestEntry.bytes.length > WORKFLOW_SHARE_PACKAGE_MAX_MANIFEST_BYTES) {
    throw new Error("工作流分享包 manifest 超过大小限制。")
  }

  let rawManifest: unknown
  try {
    rawManifest = JSON.parse(decodeUtf8(manifestEntry.bytes))
  } catch (error) {
    throw new Error("工作流分享包 manifest 无法解析。", { cause: error })
  }
  const manifest = workflowShareManifestV4Schema.parse(rawManifest) as WorkflowShareManifestV4
  assertSupportedWorkflowShareFormat(manifest.formatVersion)
  assertManifestRelationships(manifest)

  const expectedPaths = new Set(["manifest.json", ...manifest.files.map((file) => file.path)])
  if (entries.size !== expectedPaths.size || [...entries.keys()].some((entryPath) => !expectedPaths.has(entryPath))) {
    throw new Error("工作流分享包包含未声明文件。")
  }

  const fileByPath = new Map(manifest.files.map((file) => [file.path, file]))
  for (const [filePath, descriptor] of fileByPath) {
    const entry = entries.get(filePath)
    if (!entry) throw new Error(`工作流分享包缺少文件 ${filePath}。`)
    if (entry.bytes.length !== descriptor.size || sha256(entry.bytes) !== descriptor.sha256) {
      throw new Error(`工作流分享包文件校验失败：${filePath}`)
    }
  }

  const workflows: Record<string, WorkflowDefinition> = {}
  for (const item of manifest.workflows) {
    const entry = entries.get(item.path)
    if (!entry) throw new Error(`工作流分享包缺少工作流 ${item.ref}。`)
    let workflow: WorkflowDefinition
    try {
      workflow = JSON.parse(decodeUtf8(entry.bytes)) as WorkflowDefinition
    } catch (error) {
      throw new Error(`工作流文档无法解析：${item.ref}`, { cause: error })
    }
    if (workflow.id !== item.sourceWorkflowId || workflow.version !== item.sourceRevision) {
      throw new Error(`工作流身份或修订不一致：${item.ref}`)
    }
    if (workflow.meta?.schemaVersion !== item.schemaVersion) {
      throw new Error(`工作流 schema 版本不一致：${item.ref}`)
    }
    workflows[item.ref] = workflow
  }
  return { manifest, workflows }
}

export function assertSupportedWorkflowShareFormat(formatVersion: string): void {
  const version = parseSemver(formatVersion)
  const current = parseSemver(SYNAPSE_WORKFLOW_PACKAGE_FORMAT_VERSION)
  if (version.major !== current.major) {
    throw new Error(`不支持工作流分享包版本 ${formatVersion}。`)
  }
}

function assertManifestRelationships(manifest: WorkflowShareManifestV4): void {
  assertUnique(manifest.workflows.map((workflow) => workflow.ref), "工作流引用重复。")
  assertUnique(manifest.workflows.map((workflow) => workflow.sourceWorkflowId), "来源工作流 ID 重复。")
  assertUnique(manifest.workflows.map((workflow) => workflow.path), "工作流文件路径重复。")
  assertUnique(manifest.files.map((file) => file.path), "文件清单路径重复。")
  assertUnique(manifest.requiredCapabilities.map((capability) => capability.id), "必需能力重复。")
  const workflowRefs = new Set(manifest.workflows.map((workflow) => workflow.ref))
  if (manifest.entrypoints.some((ref) => !workflowRefs.has(ref))) throw new Error("入口工作流引用不存在。")
  if (manifest.workflows.some((workflow) => !manifest.files.some((file) => file.path === workflow.path))) {
    throw new Error("工作流文件没有进入文件清单。")
  }
  const workflowPaths = new Set(manifest.workflows.map((workflow) => workflow.path))
  if (manifest.files.length !== workflowPaths.size || manifest.files.some((file) => !workflowPaths.has(file.path))) {
    throw new Error("当前版本的文件清单只能包含工作流文档。")
  }
  const occurrenceCount = [
    ...manifest.references.models,
    ...manifest.references.projects,
    ...manifest.references.resources,
    ...manifest.references.environments,
    ...manifest.references.runtimes,
  ].reduce((total, reference) => total + reference.occurrences.length, 0)
  if (occurrenceCount > WORKFLOW_SHARE_PACKAGE_MAX_OCCURRENCES) {
    throw new Error("工作流分享包依赖位置过多。")
  }
  const locations = [
    ...manifest.references.models.flatMap((reference) => reference.occurrences),
    ...manifest.references.projects.flatMap((reference) => reference.occurrences),
    ...manifest.references.resources.flatMap((reference) => reference.occurrences),
    ...manifest.references.environments.flatMap((reference) => reference.occurrences),
    ...manifest.references.runtimes.flatMap((reference) => reference.occurrences),
    ...manifest.risks.sensitiveLocations,
    ...manifest.risks.highRiskLocations,
    ...manifest.risks.portabilityWarnings,
  ]
  if (locations.some((location) => !workflowRefs.has(location.workflowRef))) {
    throw new Error("工作流分享包包含无效依赖位置。")
  }
}

function assertUnique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) throw new Error(message)
}

function parseSemver(value: string): { major: number; minor: number; patch: number } {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) throw new Error(`无效版本号 ${value}。`)
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}
