import path from "node:path"
import { arePathsEqualForCompare } from "../../src/lib/path-compare"
import type {
  SynapseEditorResolvedTarget,
  SynapseInstallToEditorPayload,
  SynapseReadEditorInstallFormValuesPayload,
} from "../../src/types/editor"
import { configStore } from "./config-store"
import { editorAdapterById } from "./editor-adapters"

const UNTRUSTED_INSTALL_TARGET_ERROR = "安装目标不在已配置编辑器路径中。"

type TrustedRuleTargetPath = {
  kind: "directory" | "file"
  targetPath: string
}

function isSameEditorPath(left: string, right: string): boolean {
  return arePathsEqualForCompare(left, right, {
    platform: process.platform,
    resolvePath: path.resolve,
  })
}

function isPathInsideDirectory(targetPath: string, directoryPath: string): boolean {
  const relative = path.relative(path.resolve(directoryPath), path.resolve(targetPath))
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)
}

function inferRuleTargetKind(targetPath: string): TrustedRuleTargetPath["kind"] {
  return path.basename(targetPath) === "rules" ? "directory" : "file"
}

function isTrustedRuleTargetPath(targetPath: string, trusted: TrustedRuleTargetPath): boolean {
  if (trusted.kind === "file") {
    return isSameEditorPath(targetPath, trusted.targetPath)
  }

  return isSameEditorPath(targetPath, trusted.targetPath) || isPathInsideDirectory(targetPath, trusted.targetPath)
}

async function getTrustedRuleTargets(editorId: string): Promise<TrustedRuleTargetPath[]> {
  const adapter = editorAdapterById.get(editorId)
  if (!adapter) return []

  const targets: TrustedRuleTargetPath[] = []
  const scanConfig = adapter.getScanPathConfig()
  if (scanConfig.globalRulesPath) {
    targets.push({
      kind: inferRuleTargetKind(scanConfig.globalRulesPath),
      targetPath: scanConfig.globalRulesPath,
    })
  }

  const config = await configStore.load()
  for (const project of config.global.projects) {
    const rulesPath = scanConfig.projectPaths(project.path).rulesPath
    targets.push({
      kind: inferRuleTargetKind(rulesPath),
      targetPath: rulesPath,
    })
  }

  const seen = new Set<string>()
  return targets.filter((target) => {
    const key = `${target.kind}:${path.resolve(target.targetPath)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function assertTrustedInstallFormTarget(
  payload: SynapseReadEditorInstallFormValuesPayload,
): Promise<void> {
  const targets = await getTrustedRuleTargets(payload.editorId)
  const isTrusted = targets.some((target) => isTrustedRuleTargetPath(payload.targetPath, target))
  if (!isTrusted) {
    throw new Error(UNTRUSTED_INSTALL_TARGET_ERROR)
  }
}

async function assertTrustedResolvedRuleTarget(
  payload: SynapseInstallToEditorPayload,
  target: SynapseEditorResolvedTarget,
): Promise<void> {
  if (payload.contentType !== "rule") return
  if (target.status !== "ready" && target.status !== "conflict") return
  const targets = await getTrustedRuleTargets(payload.editorId)
  const isTrusted = targets.some((trusted) => isTrustedRuleTargetPath(target.targetPath, trusted))
  if (!isTrusted) {
    throw new Error(UNTRUSTED_INSTALL_TARGET_ERROR)
  }
}

export {
  assertTrustedInstallFormTarget,
  assertTrustedResolvedRuleTarget,
  isSameEditorPath,
}
