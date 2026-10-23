import { z } from "zod"
import type { MainAppCapabilityManifest } from "../../manifest"

export const MAIL_SERVICE_ID = "core.mail"
export const MAIL_OPEN_HANDLER = "mail.message.open"
export const MAIL_MESSAGE_ID_PATTERN = /^em_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export function parseMailReference(reference: string): string | null {
  const prefix = "synapse://mail/"
  if (!reference.startsWith(prefix)) return null
  const id = reference.slice(prefix.length)
  return MAIL_MESSAGE_ID_PATTERN.test(id) ? id : null
}

export const mailCapabilityManifest = {
  id: "mail", deepLinks: [],
  protocolRoutes: [{
    hostname: "mail", action: "open", mainHandlerId: MAIL_OPEN_HANDLER,
    paramsSchema: z.object({ deepLink: z.string().max(2048).refine((s) => parseMailReference(s) !== null) }).strict(),
  }],
} as const satisfies MainAppCapabilityManifest
