import { mailInternalReceivedConfigSchema } from "./schema"
import { mailTriggerVariables } from "../mail-trigger-variables"
export const mailInternalReceivedManifest = { id: "builtin.mail-internal-received", title: "收到新的站内信", kind: "event" as const, defaultConfig: {}, configSchema: mailInternalReceivedConfigSchema, variables: mailTriggerVariables(false) }
