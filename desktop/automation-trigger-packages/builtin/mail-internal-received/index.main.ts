import type { AutomationTriggerDefinition } from "../../types.shared"
import { mailInternalReceivedManifest } from "./manifest"
export const mailInternalReceivedDefinition = { activationRequired: true, manifest: mailInternalReceivedManifest, summarize: () => "收到新的站内信", runtime: { shouldAcceptEvent: ({ event }) => event.source === "mail-internal" && event.type === "message.received" } } satisfies AutomationTriggerDefinition
