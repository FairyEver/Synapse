import type {
  BuiltinCapabilityPackageManifestV1,
  BuiltinCapabilitySurfaceDiscovery,
} from "./manifest"
import { javascriptRunPackageManifest } from "./javascript-run/shared/manifest"
import { nodejsRunPackageManifest } from "./nodejs-run/shared/manifest"
import { clipboardPackageManifest } from "./clipboard/shared/manifest"

const builtinCapabilityPackages = [
  clipboardPackageManifest,
  javascriptRunPackageManifest,
  nodejsRunPackageManifest,
] as const satisfies readonly BuiltinCapabilityPackageManifestV1[]

export function listBuiltinCapabilityPackages(): readonly BuiltinCapabilityPackageManifestV1[] {
  return builtinCapabilityPackages
}

export function listDiscoverableBuiltinWorkflowNodeTypes(
  registeredTypes: readonly string[],
): string[] {
  return filterDiscoverableTypes(
    registeredTypes,
    listBuiltinCapabilityPackages().flatMap((manifest) => manifest.workflowNodes),
  )
}

export function listDiscoverableBuiltinAutomationActionTypes(
  registeredTypes: readonly string[],
): string[] {
  return filterDiscoverableTypes(
    registeredTypes,
    listBuiltinCapabilityPackages().flatMap((manifest) => manifest.automationActions),
  )
}

export function filterDiscoverableTypes(
  registeredTypes: readonly string[],
  declaredSurfaces: readonly {
    readonly type: string
    readonly discovery: BuiltinCapabilitySurfaceDiscovery
  }[],
): string[] {
  const discoveryByType = new Map(
    declaredSurfaces.map((surface) => [surface.type, surface.discovery] as const),
  )
  return registeredTypes.filter((type) => discoveryByType.get(type) !== "hidden")
}

export function validateBuiltinCapabilityPackages(input: {
  readonly workflowNodeTypes: readonly string[]
  readonly automationActionTypes: readonly string[]
  readonly capabilityIds: readonly string[]
}): void {
  const packageIds = new Set<string>()
  const capabilityIds = new Set<string>()
  const workflowNodeTypes = new Set<string>()
  const automationActionTypes = new Set<string>()
  const mcpToolNames = new Set<string>()
  const deepLinkActions = new Set<string>()
  const semver = /^\d+\.\d+\.\d+$/

  for (const manifest of builtinCapabilityPackages as readonly BuiltinCapabilityPackageManifestV1[]) {
    if (packageIds.has(manifest.packageId)) throw new Error(`Duplicate package id: ${manifest.packageId}`)
    if (!semver.test(manifest.packageVersion)) throw new Error(`Invalid package version: ${manifest.packageVersion}`)
    packageIds.add(manifest.packageId)
    const packageCapabilities = new Set(manifest.capabilities.map((capability) => capability.id))
    for (const capability of manifest.capabilities) {
      if (capabilityIds.has(capability.id)) throw new Error(`Duplicate capability id: ${capability.id}`)
      if (!semver.test(capability.version)) throw new Error(`Invalid capability version: ${capability.version}`)
      capabilityIds.add(capability.id)
    }
    for (const surface of manifest.workflowNodes) {
      if (!packageCapabilities.has(surface.capabilityId)) throw new Error(`Undeclared Workflow capability: ${surface.capabilityId}`)
      if (workflowNodeTypes.has(surface.type)) throw new Error(`Duplicate Workflow node type: ${surface.type}`)
      workflowNodeTypes.add(surface.type)
    }
    for (const surface of manifest.automationActions) {
      if (!packageCapabilities.has(surface.capabilityId)) throw new Error(`Undeclared Automation capability: ${surface.capabilityId}`)
      if (automationActionTypes.has(surface.type)) throw new Error(`Duplicate Automation action type: ${surface.type}`)
      automationActionTypes.add(surface.type)
    }
    for (const surface of manifest.mcpTools) {
      if (!packageCapabilities.has(surface.capabilityId)) throw new Error(`Undeclared MCP capability: ${surface.capabilityId}`)
      if (mcpToolNames.has(surface.name)) throw new Error(`Duplicate MCP tool name: ${surface.name}`)
      mcpToolNames.add(surface.name)
    }
    for (const surface of manifest.deepLinks) {
      if (!packageCapabilities.has(surface.capabilityId)) throw new Error(`Undeclared Deep Link capability: ${surface.capabilityId}`)
      const key = `${manifest.packageId}:${surface.action}`
      if (deepLinkActions.has(key)) throw new Error(`Duplicate Deep Link action: ${key}`)
      deepLinkActions.add(key)
    }
    if (
      manifest.systemApp?.defaultDock
      && (!manifest.systemApp.openable || !manifest.systemApp.pinnableToDock)
    ) {
      throw new Error(`Default Dock App must be openable and pinnable: ${manifest.systemApp.id}`)
    }
  }

  assertSameSet("Workflow node", workflowNodeTypes, new Set(input.workflowNodeTypes))
  assertSameSet("Automation action", automationActionTypes, new Set(input.automationActionTypes))
  for (const capabilityId of capabilityIds) {
    if (!input.capabilityIds.includes(capabilityId)) {
      throw new Error(`Capability catalog is missing: ${capabilityId}`)
    }
  }
}

function assertSameSet(label: string, declared: Set<string>, registered: Set<string>): void {
  for (const id of declared) {
    if (!registered.has(id)) throw new Error(`${label} contribution is missing: ${id}`)
  }
  for (const id of registered) {
    if (!declared.has(id)) throw new Error(`${label} contribution is undeclared: ${id}`)
  }
}
