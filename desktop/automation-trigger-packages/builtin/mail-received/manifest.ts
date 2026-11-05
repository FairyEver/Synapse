import { mailReceivedConfigSchema } from "./schema"
import { mailTriggerVariables } from "../mail-trigger-variables"
export const mailReceivedManifest = { id: "builtin.mail-received", title: "收到新的邮件", kind: "event" as const, defaultConfig: {}, configSchema: mailReceivedConfigSchema, variables: mailTriggerVariables(true) }
