export type MenuLeaf = {
  title: string
  breadcrumbs: string[]
  path: string
  permission: string | null
  iframe: boolean
  capabilityPath: string
}
export type MenuAudit = {
  portalRepo: string
  revision: string | null
  environment: string
  sourceHashes: Record<string, string>
  adapters: string[]
  systems: Array<{ key: string; title: string; leaves: MenuLeaf[] }>
}
export type CoverageCapability = { id: string; title: string; pagePath: string; write: boolean }
export type CoverageDescription = { ok: boolean; ai?: { gaps?: string[] } | null }
export type CoverageReport = {
  title: string
  metric: string
  source: Omit<MenuAudit, 'systems'> & { systems?: undefined; sdkEntryHash?: string }
  totalRegisteredCapabilities: number
  systems: Array<{
    key: string
    title: string
    activeLeaves: number
    attachedLeaves: number
    pageAttachmentRate: number | null
    registeredCapabilityCount: number
    registeredCapabilityIds: string[]
    zeroCapabilityLeaves: Array<{ title: string; path: string; capabilityPath: string }>
    explicitAiGaps: Array<{ capabilityId: string; path: string; gaps: string[] }>
    missingAiDescriptions: string[]
    functionalCoverage: string
    browserVerification: string
    leaves: Array<MenuLeaf & {
      capabilities: Array<{ id: string; title: string; write: boolean; ai: string; aiGaps: string[] }>
      functionalCoverage: string
      browserVerification: string
    }>
  }>
  functionalCoverage: string
  actionInventory: string
  browserVerification: string
  limitations: string[]
}
export function evaluatePortalMenus(portalRepo?: string): Promise<MenuAudit>
export function buildCoverage(menuAudit: MenuAudit, capabilities: CoverageCapability[], describe: (id: string) => CoverageDescription): CoverageReport
export function coverageCheckPassed(report: CoverageReport): boolean
