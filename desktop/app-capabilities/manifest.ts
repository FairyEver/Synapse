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

