import { z } from "zod"
import type { MainAppCapabilityManifest } from "../../manifest"

export const MAIL_OPEN_HANDLER = "mail.message.open"

export const mailCapabilityManifest = {
  id: "mail",
  deepLinks: [],
  protocolRoutes: [{
    hostname: "mail", action: "open", mainHandlerId: MAIL_OPEN_HANDLER,
    paramsSchema: z.object({ deepLink: z.string().max(2048).refine((raw) => {
      try {
        const url = new URL(raw)
        return url.protocol === "synapse:" && url.hostname === "mail" && /^\/[a-zA-Z0-9_-]{1,200}$/u.test(url.pathname) && !url.search && !url.hash
      } catch { return false }
    }) }).strict(),
  }],
} as const satisfies MainAppCapabilityManifest
