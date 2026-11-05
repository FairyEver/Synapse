import type { AutomationTriggerDefinition } from "../../types.shared"
import { mailReceivedManifest } from "./manifest"
export const mailReceivedDefinition = { activationRequired: true, manifest: mailReceivedManifest, summarize: () => "收到新的邮件", runtime: { shouldAcceptEvent: ({ event }) => event.source === "mail" && event.type === "message.received" } } satisfies AutomationTriggerDefinition
