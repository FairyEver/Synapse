import type { AutomationTriggerDefinition } from "../../types.shared"
import { mailReceivedManifest } from "./manifest"
export const mailReceivedDefinition = { activationRequired: true, manifest: mailReceivedManifest, summarize: config => config.accountId ? "指定邮箱账号" : "全部邮箱账号", runtime: { shouldAcceptEvent: ({ event }) => event.source === "mail" && event.type === "message.received" } } satisfies AutomationTriggerDefinition
