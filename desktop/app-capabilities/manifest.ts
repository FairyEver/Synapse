import type { z } from "zod"

export type AppDeepLinkDeclaration = {
  readonly action: string
  readonly capabilityId: string
  readonly paramsSchema: z.ZodType<Record<string, unknown>>
}

export type MainAppCapabilityManifest = {
  readonly id: string
  readonly deepLinks?: readonly AppDeepLinkDeclaration[]
}

export type BuiltinCapabilitySurfaceDiscovery = "visible" | "hidden"

export type BuiltinCapabilityPackageManifestV1 = {
  readonly schemaVersion: 1
  readonly packageId: string
  readonly packageVersion: string
  readonly capabilities: readonly {
    readonly id: string
    readonly version: string
    readonly availability: "always"
    readonly userToggle: "none"
  }[]
  readonly workflowNodes: readonly {
    readonly type: string
    readonly capabilityId: string
    readonly discovery: BuiltinCapabilitySurfaceDiscovery
  }[]
  readonly automationActions: readonly {
    readonly type: string
    readonly capabilityId: string
    readonly discovery: BuiltinCapabilitySurfaceDiscovery
  }[]
  readonly mcpTools: readonly {
    readonly name: string
    readonly capabilityId: string
  }[]
  readonly systemApp: null | {
    readonly id: string
    readonly discovery: BuiltinCapabilitySurfaceDiscovery
    readonly defaultDock: boolean
    readonly pinnableToDock: boolean
    readonly openable: boolean
  }
  readonly deepLinks: readonly {
    readonly action: string
    readonly capabilityId: string
  }[]
}
