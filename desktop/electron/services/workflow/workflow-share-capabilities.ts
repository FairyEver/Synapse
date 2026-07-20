import type { WorkflowShareRequiredCapability } from "../../../src/types/workflow-package"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"

export interface WorkflowShareCapabilitySupport {
  readonly supported: boolean
  readonly issues: string[]
}

export function installedWorkflowShareCapabilities(
  additional: readonly WorkflowShareRequiredCapability[] = [],
): Map<string, string> {
  const capabilities = new Map<string, string>()
  for (const manifest of nodeTypeRegistry.listManifests()) {
    const requirement = manifest.share.capability
    setHighestVersion(capabilities, requirement.id, requirement.minVersion)
  }
  for (const requirement of additional) {
    setHighestVersion(capabilities, requirement.id, requirement.minVersion)
  }
  return capabilities
}

export function checkWorkflowShareCapabilities(
  required: readonly WorkflowShareRequiredCapability[],
  installed: ReadonlyMap<string, string>,
): WorkflowShareCapabilitySupport {
  const issues: string[] = []
  for (const requirement of required) {
    const version = installed.get(requirement.id)
    if (!version) {
      issues.push(`缺少必需能力 ${requirement.id}。`)
      continue
    }
    if (compareSemver(version, requirement.minVersion) < 0) {
      issues.push(`能力 ${requirement.id} 需要 ${requirement.minVersion}，当前为 ${version}。`)
    }
  }
  return { supported: issues.length === 0, issues }
}

function setHighestVersion(capabilities: Map<string, string>, id: string, version: string): void {
  const current = capabilities.get(id)
  if (!current || compareSemver(version, current) > 0) capabilities.set(id, version)
}

function compareSemver(left: string, right: string): number {
  const leftParts = parseSemver(left)
  const rightParts = parseSemver(right)
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index]
    if (difference !== 0) return difference
  }
  return 0
}

function parseSemver(value: string): readonly [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) throw new Error(`Invalid capability version: ${value}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}
