import { createHash } from 'node:crypto'
import { ALL_CAPABILITY_DEFINITIONS } from '../capabilities/index.js'
import { CAPABILITY_BINDINGS } from '../capabilities/invoke.js'

/** Executable bindings, including bindings absent from discovery, are the authority. */
export function permissionCapabilityRegistry() {
  const pages = new Map(ALL_CAPABILITY_DEFINITIONS.map(capability => [capability.id, capability]))
  return CAPABILITY_BINDINGS.map(binding => ({ id: binding.capabilityId, sdkPath: binding.sdkPath,
    pagePath: pages.get(binding.capabilityId)?.pagePath ?? '', httpInstance: pages.get(binding.capabilityId)?.httpInstance ?? '' }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
export function permissionRegistryHash(): string {
  return createHash('sha256').update(JSON.stringify(permissionCapabilityRegistry())).digest('hex')
}
