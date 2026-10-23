import { z } from "zod"
import type { MainAppCapabilityManifest } from "../../manifest"

export const MAIL_INTERNAL_OPEN_HANDLER = "mail-internal.message.open"

export const mailInternalCapabilityManifest = {
  id: "mail-internal",
  deepLinks: [],
  protocolRoutes: [{
    hostname: "mail-internal", action: "open", mainHandlerId: MAIL_INTERNAL_OPEN_HANDLER,
    paramsSchema: z.object({ deepLink: z.string().max(2048).refine((raw) => {
      try {
        const url = new URL(raw)
        return url.protocol === "synapse:" && url.hostname === "mail-internal" && /^\/[a-zA-Z0-9_-]{1,200}$/u.test(url.pathname) && !url.search && !url.hash
      } catch { return false }
    }) }).strict(),
  }],
} as const satisfies MainAppCapabilityManifest
