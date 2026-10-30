import type { z } from "zod"

export type AppDeepLinkDeclaration = {
  readonly action: string
  readonly capabilityId: string
  readonly paramsSchema: z.ZodType<Record<string, unknown>>
}

export type AppProtocolRouteDeclaration = {
  readonly hostname: string
  readonly action: string
  readonly paramsSchema: z.ZodType<Record<string, unknown>>
} & ({ readonly capabilityId: string } | { readonly mainHandlerId: string })

export type AppPathRouteDeclaration = {
  readonly path: string
  readonly action: string
  readonly mainHandlerId: string
  readonly defaults?: Readonly<Record<string, string>>
  readonly paramsSchema: z.ZodType<Record<string, unknown>>
}
export type MainAppCapabilityManifest = {
  readonly pathRoutes?:readonly AppPathRouteDeclaration[]
  readonly id: string
  readonly deepLinks?: readonly AppDeepLinkDeclaration[]
  readonly protocolRoutes?: readonly AppProtocolRouteDeclaration[]
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
