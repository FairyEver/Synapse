import { z } from "zod"
import type { MainAppCapabilityManifest } from "../../manifest"
import { parsePortalCallback } from "./portal-contract"

export const PORTAL_TEST_CALLBACK_HANDLER = "connectors.portal-headless-test.callback"
export const connectorsCapabilityManifest = {
  id: "connectors",
  deepLinks: [],
  protocolRoutes: [{
    hostname: "portal-headless-test", action: "callback", mainHandlerId: PORTAL_TEST_CALLBACK_HANDLER,
    paramsSchema: z.object({ deepLink: z.string().max(65536).refine((raw) => {
      try { parsePortalCallback(raw, "synapse://portal-headless-test/callback"); return true }
      catch { return false }
    }) }).strict(),
  }],
} as const satisfies MainAppCapabilityManifest
